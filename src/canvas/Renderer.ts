/**
 * Canvas renderer (brief §3 architecture: "Render scheduling").
 *
 * Two layers:
 *   - `committed`: offscreen canvas holding background + committed objects,
 *     redrawn only when the document, view or viewport changes.
 *   - visible canvas: presents the committed layer, then draws the live
 *     stroke, live shape, selection, alignment guides and eraser cursor.
 *
 * All rendering is scheduled through requestAnimationFrame; input events only
 * mark state dirty. React never sees per-point data.
 */

import type { NotebookDoc, PageObject, SampledPoint, ShapeKind } from '../documents/DocumentModel'
import { objectBounds } from '../documents/DocumentModel'
import { documentToScreen } from './CoordinateSystem'
import type { ViewTransform } from './CoordinateSystem'
import { sizeCanvasBuffer } from './CoordinateSystem'
import { paintBackground, paintObject } from './Painter'
import { paintLiveStroke } from '../ink/StrokeRenderer'

export interface LiveStroke {
  points: SampledPoint[]
  color: string
  width: number
  tool: 'pen' | 'highlighter'
}

export interface LiveShape {
  kind: ShapeKind
  x1: number
  y1: number
  x2: number
  y2: number
  color: string
  width: number
}

export interface EraserCursor {
  x: number
  y: number
  radius: number
}

export interface AlignmentOverlay {
  guideXs: number[]
  guideYs: number[]
}

export class CanvasRenderer {
  private readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D
  private readonly committed: HTMLCanvasElement
  private readonly committedCtx: CanvasRenderingContext2D

  private notebook: NotebookDoc | null = null
  private pageId = ''
  private view: ViewTransform = { zoom: 1, panX: 0, panY: 0 }
  private dpr = 1
  private cssW = 0
  private cssH = 0

  private liveStroke: LiveStroke | null = null
  private liveShape: LiveShape | null = null
  private selectionIds: readonly string[] = []
  private hiddenIds: ReadonlySet<string> = new Set()
  private offsetPreview: { ids: ReadonlySet<string>; dx: number; dy: number } | null = null
  private eraserCursor: EraserCursor | null = null
  private alignment: AlignmentOverlay | null = null

  private rafId: number | null = null
  private committedDirty = true

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D context unavailable')
    this.ctx = ctx
    this.committed = document.createElement('canvas')
    const cctx = this.committed.getContext('2d')
    if (!cctx) throw new Error('Canvas 2D context unavailable (committed layer)')
    this.committedCtx = cctx
  }

  setViewport(cssW: number, cssH: number, dpr: number): void {
    this.cssW = cssW
    this.cssH = cssH
    this.dpr = dpr
    sizeCanvasBuffer(this.canvas, cssW, cssH, dpr)
    sizeCanvasBuffer(this.committed, cssW, cssH, dpr)
    this.committedDirty = true
    this.requestRender()
  }

  setNotebook(notebook: NotebookDoc | null, pageId: string): void {
    this.notebook = notebook
    this.pageId = pageId
    this.committedDirty = true
    this.requestRender()
  }

  setView(view: ViewTransform): void {
    this.view = view
    this.committedDirty = true
    this.requestRender()
  }

  setLiveStroke(live: LiveStroke | null): void {
    this.liveStroke = live
    this.requestRender()
  }

  setLiveShape(live: LiveShape | null): void {
    this.liveShape = live
    this.requestRender()
  }

  setSelection(ids: readonly string[]): void {
    this.selectionIds = ids
    this.requestRender()
  }

  /** Objects temporarily invisible during erase/move gestures. */
  setHiddenIds(ids: Iterable<string>): void {
    this.hiddenIds = new Set(ids)
    this.committedDirty = true
    this.requestRender()
  }

  /** Translated preview while dragging a selection. */
  setOffsetPreview(ids: readonly string[], dx: number, dy: number): void {
    this.offsetPreview = { ids: new Set(ids), dx, dy }
    this.requestRender()
  }

  setEraserCursor(cursor: EraserCursor | null): void {
    this.eraserCursor = cursor
    this.requestRender()
  }

  setAlignmentOverlay(overlay: AlignmentOverlay | null): void {
    this.alignment = overlay
    this.requestRender()
  }

  requestRender(): void {
    if (this.rafId !== null) return
    this.rafId = requestAnimationFrame(() => {
      this.rafId = null
      this.renderNow()
    })
  }

  destroy(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
  }

  private currentPage(): PageObject[] {
    if (!this.notebook) return []
    const page = this.notebook.pages.find((p) => p.id === this.pageId)
    return page ? page.objects : []
  }

  private pageBackground(): { background: NotebookDoc['pages'][number]['background']; paperColor: string } {
    const page = this.notebook?.pages.find((p) => p.id === this.pageId)
    return { background: page?.background ?? 'blank', paperColor: page?.paperColor ?? '#ffffff' }
  }

  private drawCommitted(): void {
    const ctx = this.committedCtx
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    ctx.clearRect(0, 0, this.cssW, this.cssH)
    const bg = this.pageBackground()
    const pageForBackground = {
      id: this.pageId,
      name: '',
      background: bg.background,
      paperColor: bg.paperColor,
      objects: [],
      createdAt: 0,
      updatedAt: 0,
    }
    paintBackground(ctx, pageForBackground, this.view, this.dpr, this.cssW, this.cssH)

    ctx.setTransform(
      this.view.zoom * this.dpr,
      0,
      0,
      this.view.zoom * this.dpr,
      this.view.panX * this.view.zoom * this.dpr,
      this.view.panY * this.view.zoom * this.dpr,
    )
    for (const obj of this.currentPage()) {
      if (this.hiddenIds.has(obj.id)) continue
      paintObject(ctx, obj)
    }
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
  }

  renderNow(): void {
    if (this.committedDirty) {
      this.drawCommitted()
      this.committedDirty = false
    }
    const ctx = this.ctx
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    ctx.drawImage(this.committed, 0, 0)

    // Live stroke in document space.
    if (this.liveStroke && this.liveStroke.points.length > 0) {
      ctx.setTransform(
        this.view.zoom * this.dpr,
        0,
        0,
        this.view.zoom * this.dpr,
        this.view.panX * this.view.zoom * this.dpr,
        this.view.panY * this.view.zoom * this.dpr,
      )
      paintLiveStroke(ctx, this.liveStroke.points, this.liveStroke.color, this.liveStroke.width, this.liveStroke.tool)
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    }

    // Live shape preview.
    if (this.liveShape) {
      const s = this.liveShape
      ctx.save()
      ctx.strokeStyle = s.color
      ctx.lineWidth = s.width
      ctx.setLineDash([6, 4])
      ctx.beginPath()
      if (s.kind === 'line' || s.kind === 'arrow') {
        ctx.moveTo(s.x1, s.y1)
        ctx.lineTo(s.x2, s.y2)
      } else {
        const minX = Math.min(s.x1, s.x2)
        const minY = Math.min(s.y1, s.y2)
        const w = Math.abs(s.x2 - s.x1)
        const h = Math.abs(s.y2 - s.y1)
        if (s.kind === 'rectangle') ctx.rect(minX, minY, w, h)
        else ctx.ellipse(minX + w / 2, minY + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2)
      }
      ctx.stroke()
      ctx.restore()
    }

    // Offset preview while moving a selection (drawn above everything).
    if (this.offsetPreview) {
      const { ids, dx, dy } = this.offsetPreview
      ctx.save()
      ctx.setTransform(
        this.view.zoom * this.dpr,
        0,
        0,
        this.view.zoom * this.dpr,
        (this.view.panX + dx) * this.view.zoom * this.dpr,
        (this.view.panY + dy) * this.view.zoom * this.dpr,
      )
      for (const obj of this.currentPage()) {
        if (!ids.has(obj.id)) continue
        paintObject(ctx, obj)
      }
      ctx.restore()
    }

    // Selection bounds.
    if (this.selectionIds.length > 0) {
      const objects = this.currentPage().filter((o) => this.selectionIds.includes(o.id))
      if (objects.length > 0) {
        let minX = Infinity
        let minY = Infinity
        let maxX = -Infinity
        let maxY = -Infinity
        for (const o of objects) {
          const b = objectBounds(o)
          minX = Math.min(minX, b.minX)
          minY = Math.min(minY, b.minY)
          maxX = Math.max(maxX, b.maxX)
          maxY = Math.max(maxY, b.maxY)
        }
        const pad = 6 / this.view.zoom
        const tl = documentToScreen(minX - pad, minY - pad, this.view)
        const br = documentToScreen(maxX + pad, maxY + pad, this.view)
        ctx.save()
        ctx.strokeStyle = getComputedStyleCanvasAccent(this.canvas)
        ctx.lineWidth = 1.5
        ctx.setLineDash([5, 3])
        ctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y)
        ctx.setLineDash([])
        ctx.fillStyle = getComputedStyleCanvasAccent(this.canvas)
        for (const hx of [tl.x, (tl.x + br.x) / 2, br.x]) {
          for (const hy of [tl.y, (tl.y + br.y) / 2, br.y]) {
            ctx.fillRect(hx - 3, hy - 3, 6, 6)
          }
        }
        ctx.restore()
      }
    }

    // Alignment guides.
    if (this.alignment) {
      ctx.save()
      ctx.strokeStyle = '#e05f8f'
      ctx.lineWidth = 1
      for (const gx of this.alignment.guideXs) {
        const sx = documentToScreen(gx, 0, this.view).x
        ctx.beginPath()
        ctx.moveTo(sx, 0)
        ctx.lineTo(sx, this.cssH)
        ctx.stroke()
      }
      for (const gy of this.alignment.guideYs) {
        const sy = documentToScreen(0, gy, this.view).y
        ctx.beginPath()
        ctx.moveTo(0, sy)
        ctx.lineTo(this.cssW, sy)
        ctx.stroke()
      }
      ctx.restore()
    }

    // Eraser cursor.
    if (this.eraserCursor) {
      const c = this.eraserCursor
      const s = documentToScreen(c.x, c.y, this.view)
      ctx.save()
      ctx.strokeStyle = '#8e8e93'
      ctx.lineWidth = 1.25
      ctx.beginPath()
      ctx.arc(s.x, s.y, Math.max(6, c.radius * this.view.zoom), 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()
    }
  }
}

/** Selection accent color, resolved from CSS custom properties. */
function getComputedStyleCanvasAccent(canvas: HTMLCanvasElement): string {
  const v = getComputedStyle(canvas).getPropertyValue('--selection-accent').trim()
  return v || '#0a84ff'
}
