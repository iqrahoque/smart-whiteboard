/**
 * Pointer input controller (brief §5).
 *
 * A plain class bound to the canvas element — deliberately outside React.
 * Owns the gesture state machine (idle / drawing / erasing / shaping /
 * moving / panning / pinching) and translates high-frequency pointer events
 * into document-space callbacks. React re-renders never happen per point.
 *
 * Capacitive-stylus realities honored here:
 *  - The stylus is a finger: no pressure, hover or pen identity is assumed.
 *  - Exactly one accepted contact draws; extra simultaneous contacts are
 *    ignored while a gesture is active (palm workaround, never "rejection").
 *  - pointercancel / lostpointercapture discard the in-progress gesture.
 *  - Mouse always works (debug + accessibility).
 */

import type { Point, SampledPoint, ShapeKind, ToolId } from '../documents/DocumentModel'
import { clientToCanvas, screenToDocument } from './CoordinateSystem'
import type { CanvasRect, ViewTransform } from './CoordinateSystem'

export interface InkStyle {
  color: string
  width: number
  smoothing: 'low' | 'balanced' | 'high'
}

/** Everything the controller needs from the app, read fresh on every event. */
export interface InputBridge {
  getTool(): ToolId
  getStyle(): InkStyle
  isInkTool(): boolean
  isNavigateMode(): boolean
  isSpacePanning(): boolean
  shouldIgnoreExtraContacts(): boolean
  isSnapEnabled(): boolean
  getGridSize(): number
  getView(): ViewTransform
  getCanvasRect(): CanvasRect

  panBy(dxScreen: number, dyScreen: number): void
  zoomAt(screen: Point, factor: number): void

  beginStroke(first: SampledPoint): void
  extendStroke(p: SampledPoint): void
  endStroke(): void
  cancelStroke(): void

  beginShape(kind: ShapeKind, p: Point): void
  updateShape(p: Point): void
  endShape(p: Point): void
  cancelShape(): void

  beginErase(p: Point): void
  moveErase(p: Point): void
  endErase(): void
  cancelErase(): void

  /** Text tool: drag a marquee rectangle, enclosed handwriting converts. */
  beginTextMarquee(p: Point): void
  updateTextMarquee(p: Point): void
  endTextMarquee(p: Point, commit: boolean): void

  /** Returns true when the tap landed on an object (move gesture starts). */
  selectAt(p: Point, additive: boolean): boolean
  beginMove(p: Point): void
  moveBy(p: Point): void
  endMove(commit: boolean): void

  updateCursor(p: Point | null): void
}

type GestureMode = 'idle' | 'drawing' | 'erasing' | 'shaping' | 'textmarquee' | 'moving' | 'panning' | 'pinching'

interface TrackedPointer {
  x: number
  y: number
}

function coalesced(event: PointerEvent): PointerEvent[] {
  const list = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : []
  return list.length > 0 ? (list as PointerEvent[]) : [event]
}

export class InputController {
  private readonly canvas: HTMLCanvasElement
  private readonly bridge: InputBridge
  private mode: GestureMode = 'idle'
  private activePointerId: number | null = null
  private readonly pointers = new Map<number, TrackedPointer>()
  private lastPan: Point | null = null
  private pinchStartDist = 0
  private shapeKind: ShapeKind | null = null

  private readonly onPointerDown: (e: PointerEvent) => void
  private readonly onPointerMove: (e: PointerEvent) => void
  private readonly onPointerUp: (e: PointerEvent) => void
  private readonly onPointerCancel: (e: PointerEvent) => void
  private readonly onLostCapture: (e: PointerEvent) => void
  private readonly onWheel: (e: WheelEvent) => void
  private readonly onLeave: () => void

  constructor(canvas: HTMLCanvasElement, bridge: InputBridge) {
    this.canvas = canvas
    this.bridge = bridge

    this.onPointerDown = (e) => this.handleDown(e)
    this.onPointerMove = (e) => this.handleMove(e)
    this.onPointerUp = (e) => this.handleUp(e, true)
    this.onPointerCancel = (e) => this.handleUp(e, false)
    this.onLostCapture = (e) => this.handleUp(e, false)
    this.onWheel = (e) => this.handleWheel(e)
    this.onLeave = () => {
      if (this.mode === 'idle') this.bridge.updateCursor(null)
    }

    canvas.addEventListener('pointerdown', this.onPointerDown)
    canvas.addEventListener('pointermove', this.onPointerMove)
    canvas.addEventListener('pointerup', this.onPointerUp)
    canvas.addEventListener('pointercancel', this.onPointerCancel)
    canvas.addEventListener('lostpointercapture', this.onLostCapture)
    canvas.addEventListener('wheel', this.onWheel, { passive: false })
    canvas.addEventListener('pointerleave', this.onLeave)
  }

  destroy(): void {
    this.canvas.removeEventListener('pointerdown', this.onPointerDown)
    this.canvas.removeEventListener('pointermove', this.onPointerMove)
    this.canvas.removeEventListener('pointerup', this.onPointerUp)
    this.canvas.removeEventListener('pointercancel', this.onPointerCancel)
    this.canvas.removeEventListener('lostpointercapture', this.onLostCapture)
    this.canvas.removeEventListener('wheel', this.onWheel)
    this.canvas.removeEventListener('pointerleave', this.onLeave)
  }

  /** True while any ink/erase/shape/move gesture is in progress. */
  isBusy(): boolean {
    return this.mode !== 'idle' && this.mode !== 'panning' && this.mode !== 'pinching'
  }

  private docPoint(e: PointerEvent): Point {
    const rect = this.bridge.getCanvasRect()
    const screen = clientToCanvas(e.clientX, e.clientY, rect)
    return screenToDocument(screen.x, screen.y, this.bridge.getView())
  }

  private screenPoint(e: PointerEvent): Point {
    const rect = this.bridge.getCanvasRect()
    return clientToCanvas(e.clientX, e.clientY, rect)
  }

  private snap(p: Point): Point {
    if (!this.bridge.isSnapEnabled()) return p
    const g = this.bridge.getGridSize()
    if (g <= 0) return p
    return { x: Math.round(p.x / g) * g, y: Math.round(p.y / g) * g }
  }

  private sample(e: PointerEvent): SampledPoint {
    const p = this.docPoint(e)
    return { x: p.x, y: p.y, t: e.timeStamp }
  }

  private handleDown(e: PointerEvent): void {
    e.preventDefault()
    this.pointers.set(e.pointerId, this.screenPoint(e))
    const navigate = this.bridge.isNavigateMode() || this.bridge.isSpacePanning()

    if (navigate) {
      if (this.pointers.size === 1) {
        this.mode = 'panning'
        this.activePointerId = e.pointerId
        this.lastPan = this.screenPoint(e)
        try {
          this.canvas.setPointerCapture(e.pointerId)
        } catch {
          /* capture is best-effort */
        }
      } else if (this.pointers.size === 2) {
        this.mode = 'pinching'
        this.activePointerId = null
        this.lastPan = null
        this.pinchStartDist = this.currentPinchDist()
      }
      return
    }

    // Draw mode: exactly one gesture at a time. Extra simultaneous contacts
    // (a resting palm is just another contact) are ignored, never "rejected" —
    // a capacitive stylus is indistinguishable from a finger.
    if (this.mode !== 'idle') return
    if (this.activePointerId !== null) return
    if (this.pointers.size > 1 && this.bridge.shouldIgnoreExtraContacts()) return

    const tool = this.bridge.getTool()
    this.activePointerId = e.pointerId
    try {
      this.canvas.setPointerCapture(e.pointerId)
    } catch {
      /* capture is best-effort */
    }

    switch (tool) {
      case 'pen':
      case 'highlighter':
        this.mode = 'drawing'
        this.bridge.beginStroke(this.sample(e))
        for (const sub of coalesced(e).slice(1)) this.bridge.extendStroke(this.sample(sub))
        break
      case 'eraser':
        this.mode = 'erasing'
        this.bridge.beginErase(this.docPoint(e))
        break
      case 'text':
        this.mode = 'textmarquee'
        this.bridge.beginTextMarquee(this.docPoint(e))
        break
      case 'line':
      case 'rectangle':
      case 'ellipse':
      case 'arrow':
        this.mode = 'shaping'
        this.shapeKind = tool
        this.bridge.beginShape(tool, this.snap(this.docPoint(e)))
        break
      case 'select': {
        const hit = this.bridge.selectAt(this.docPoint(e), e.shiftKey)
        this.mode = hit ? 'moving' : 'idle'
        if (hit) this.bridge.beginMove(this.docPoint(e))
        else this.activePointerId = null
        break
      }
    }
  }

  private handleMove(e: PointerEvent): void {
    if (this.pointers.has(e.pointerId)) {
      this.pointers.set(e.pointerId, this.screenPoint(e))
    } else if (this.mode === 'idle') {
      // Hover: cursor feedback only (eraser halo). Touch may not hover.
      this.bridge.updateCursor(this.bridge.getTool() === 'eraser' ? this.docPoint(e) : null)
      return
    }

    switch (this.mode) {
      case 'drawing': {
        if (e.pointerId !== this.activePointerId) return
        for (const sub of coalesced(e)) this.bridge.extendStroke(this.sample(sub))
        break
      }
      case 'erasing': {
        if (e.pointerId !== this.activePointerId) return
        this.bridge.moveErase(this.docPoint(e))
        break
      }
      case 'textmarquee': {
        if (e.pointerId !== this.activePointerId) return
        this.bridge.updateTextMarquee(this.docPoint(e))
        break
      }
      case 'shaping': {
        if (e.pointerId !== this.activePointerId) return
        this.bridge.updateShape(this.snap(this.docPoint(e)))
        break
      }
      case 'moving': {
        if (e.pointerId !== this.activePointerId) return
        this.bridge.moveBy(this.docPoint(e))
        break
      }
      case 'panning': {
        if (e.pointerId !== this.activePointerId) return
        const s = this.screenPoint(e)
        if (this.lastPan) this.bridge.panBy(s.x - this.lastPan.x, s.y - this.lastPan.y)
        this.lastPan = s
        break
      }
      case 'pinching': {
        if (this.pointers.size < 2) return
        const dist = this.currentPinchDist()
        const mid = this.currentPinchMid()
        const prevMid = this.lastPinchMid
        this.lastPinchMid = mid
        if (this.pinchStartDist > 0 && dist > 0) {
          // Zoom is derived per-move from the running distance; the delegate
          // receives incremental factors around the midpoint.
          const factor = dist / (this.lastPinchAppliedDist || dist)
          this.lastPinchAppliedDist = dist
          if (Math.abs(factor - 1) > 0.001) this.bridge.zoomAt(mid, factor)
        }
        if (prevMid && this.lastPan === null) {
          this.bridge.panBy(mid.x - prevMid.x, mid.y - prevMid.y)
        }
        break
      }
      case 'idle':
        break
    }
  }

  private lastPinchMid: Point | null = null
  private lastPinchAppliedDist = 0

  private currentPinchDist(): number {
    const pts = [...this.pointers.values()]
    const a = pts[0]
    const b = pts[1]
    if (!a || !b) return 0
    return Math.hypot(a.x - b.x, a.y - b.y)
  }

  private currentPinchMid(): Point {
    const pts = [...this.pointers.values()]
    const a = pts[0]
    const b = pts[1]
    if (!a || !b) return { x: 0, y: 0 }
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  }

  private handleUp(e: PointerEvent, commit: boolean): void {
    this.pointers.delete(e.pointerId)

    if (this.mode === 'pinching') {
      if (this.pointers.size < 2) {
        const remaining = this.pointers.size === 1 ? [...this.pointers.keys()][0] ?? null : null
        this.mode = remaining !== null ? 'panning' : 'idle'
        this.activePointerId = remaining
        // The pan reference is the remaining pointer's own last known position,
        // so the next move produces only an incremental delta. A pinch midpoint
        // is undefined with a single pointer and must never seed the pan.
        this.lastPan = remaining !== null ? this.pointers.get(remaining) ?? null : null
        this.lastPinchMid = null
        this.lastPinchAppliedDist = 0
        this.pinchStartDist = 0
        if (remaining !== null) {
          // Keep receiving moves for the surviving pointer even if it drifts
          // off the canvas mid-pan (touch has implicit capture; mouse/pen may
          // not). Best-effort: losing capture only means edge moves are missed.
          try {
            this.canvas.setPointerCapture(remaining)
          } catch {
            /* capture is best-effort */
          }
        }
      }
      return
    }

    if (e.pointerId !== this.activePointerId && this.mode !== 'idle') return

    switch (this.mode) {
      case 'drawing':
        if (commit) this.bridge.endStroke()
        else this.bridge.cancelStroke()
        break
      case 'erasing':
        if (commit) this.bridge.endErase()
        else this.bridge.cancelErase()
        break
      case 'textmarquee':
        this.bridge.endTextMarquee(this.docPoint(e), commit)
        break
      case 'shaping':
        if (commit) this.bridge.endShape(this.snap(this.docPoint(e)))
        else this.bridge.cancelShape()
        this.shapeKind = null
        break
      case 'moving':
        this.bridge.endMove(commit)
        break
      case 'panning':
        break
      case 'idle':
        break
    }

    this.mode = 'idle'
    this.activePointerId = null
    this.lastPan = null
  }

  private handleWheel(e: WheelEvent): void {
    e.preventDefault()
    if (e.ctrlKey || e.metaKey) {
      const factor = Math.exp(-e.deltaY * 0.0025)
      this.bridge.zoomAt(this.screenPoint(e as unknown as PointerEvent), factor)
    } else {
      this.bridge.panBy(-e.deltaX, -e.deltaY)
    }
  }

  /** Shape kind captured at gesture start (for tests and debugging). */
  get activeShapeKind(): ShapeKind | null {
    return this.shapeKind
  }
}
