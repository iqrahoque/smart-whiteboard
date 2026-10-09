/**
 * buildAppBridge — the app-side InputBridge implementation.
 *
 * The bridge is the seam between React (which owns tool/style/settings state)
 * and the input/render engine (which runs outside React). It holds all
 * high-frequency gesture state — the current view, the live stroke, erase and
 * move selections — in plain mutable fields so pointer events never trigger a
 * React render. Commands are dispatched only on gesture completion.
 */

import { addObjectCommand, moveObjectsCommand, removeObjectsCommand } from '../documents/Commands'
import type { DocumentController } from '../documents/DocumentController'
import type {
  NotebookDoc,
  PageObject,
  Point,
  SampledPoint,
  ShapeKind,
  ToolId,
} from '../documents/DocumentModel'
import { createShape, createStroke, findPage, objectBounds, unionBounds } from '../documents/DocumentModel'
import { zoomView } from '../canvas/CoordinateSystem'
import type { CanvasRect, ViewTransform } from '../canvas/CoordinateSystem'
import type { InkStyle } from '../canvas/InputController'
import type { AppBridge } from '../canvas/WhiteboardCanvas'
import { hitTestObject, pickTopmostObject } from '../geometry/hitTesting'
import { computeAlignmentGuides, snapValue } from '../geometry/SnapEngine'
import type { Bounds } from '../geometry/SnapEngine'
import { recognizeShape, RECOGNIZE_THRESHOLD } from '../geometry/ShapeRecognizer'
import { processRawSamples } from '../ink/StrokeProcessor'
import type { AppSettings } from './settings'

/** Extra imperative handles the App shell needs beyond InputBridge. */
export interface BridgeExtras {
  getZoom(): number
  /** Zoom to an absolute level, centered on the visible canvas. */
  zoomTo(zoom: number): void
  zoomByFactor(factor: number): void
  clearSelection(): void
  /** Delete the selected objects; true when a command was dispatched. */
  deleteSelection(): boolean
}

export interface BridgeDeps {
  tool: { current: ToolId }
  style: { current: InkStyle }
  settings: { current: AppSettings }
  pageId: { current: string }
  navigateMode: { current: boolean }
  spacePanning: { current: boolean }
  controller: DocumentController
  /** Notified after every view change (App debounces the zoom label). */
  onViewChanged: (view: ViewTransform) => void
}

const ERASE_TOLERANCE = 8
const PICK_TOLERANCE = 8
const ALIGNMENT_TOLERANCE = 6
const ERASER_RADIUS = 10

interface MoveState {
  ids: string[]
  start: Point
  dx: number
  dy: number
  movingBounds: Bounds
  others: Bounds[]
}

export function buildAppBridge(deps: BridgeDeps): AppBridge & BridgeExtras {
  let view: ViewTransform = { zoom: 1, panX: 0, panY: 0 }
  let livePoints: SampledPoint[] = []
  let shapeStart: Point | null = null
  let shapeKind: ShapeKind | null = null
  let selectionIds: string[] = []
  let moveState: MoveState | null = null
  const erasingIds = new Set<string>()

  const currentPageObjects = (): PageObject[] => {
    const nb: NotebookDoc = deps.controller.getNotebook()
    const page = findPage(nb, deps.pageId.current)
    return page ? page.objects : []
  }

  const setView = (next: ViewTransform): void => {
    view = next
    api.renderer?.setView(view)
    deps.onViewChanged(view)
  }

  const setLive = (points: SampledPoint[]): void => {
    const style = deps.style.current
    api.renderer?.setLiveStroke({
      points,
      color: style.color,
      width: style.width,
      tool: deps.tool.current === 'highlighter' ? 'highlighter' : 'pen',
    })
  }

  const setLiveShape = (kind: ShapeKind, a: Point, b: Point): void => {
    const style = deps.style.current
    api.renderer?.setLiveShape({
      kind,
      x1: a.x,
      y1: a.y,
      x2: b.x,
      y2: b.y,
      color: style.color,
      width: style.width,
    })
  }

  const eraseAt = (p: Point): void => {
    let added = false
    for (const obj of currentPageObjects()) {
      if (!erasingIds.has(obj.id) && hitTestObject(obj, p, ERASE_TOLERANCE, 'border')) {
        erasingIds.add(obj.id)
        added = true
      }
    }
    if (added) api.renderer?.setHiddenIds(erasingIds)
  }

  const eraseCursor = (p: Point | null): void => {
    api.renderer?.setEraserCursor(p ? { x: p.x, y: p.y, radius: ERASER_RADIUS } : null)
  }

  const clearErasePreview = (): void => {
    erasingIds.clear()
    api.renderer?.setHiddenIds([])
  }

  const centerScreen = (): Point => {
    const rect: CanvasRect = api.getCanvasRect()
    return { x: rect.width / 2, y: rect.height / 2 }
  }

  const api: AppBridge & BridgeExtras = {
    renderer: null,
    canvas: null,

    getTool: () => deps.tool.current,
    getStyle: () => deps.style.current,
    isInkTool: () => deps.tool.current === 'pen' || deps.tool.current === 'highlighter',
    isNavigateMode: () => deps.navigateMode.current,
    isSpacePanning: () => deps.spacePanning.current,
    shouldIgnoreExtraContacts: () => deps.settings.current.ignoreExtraContacts,
    isSnapEnabled: () => deps.settings.current.snapEnabled,
    getGridSize: () => deps.settings.current.gridSize,
    getView: () => view,
    getCanvasRect: (): CanvasRect => {
      const el = api.canvas
      if (!el) return { left: 0, top: 0, width: 1, height: 1 }
      return el.getBoundingClientRect()
    },

    panBy: (dx, dy) => {
      const z = view.zoom > 0 ? view.zoom : 1
      setView({ zoom: view.zoom, panX: view.panX + dx / z, panY: view.panY + dy / z })
    },
    zoomAt: (screen, factor) => {
      setView(zoomView(view, screen, factor))
    },

    beginStroke: (first) => {
      livePoints = [first]
      setLive(livePoints)
    },
    extendStroke: (p) => {
      livePoints.push(p)
      setLive(livePoints)
    },
    endStroke: () => {
      const raw = livePoints
      livePoints = []
      api.renderer?.setLiveStroke(null)
      const points = processRawSamples(raw, deps.style.current.smoothing)
      if (points.length === 0) return

      const style = deps.style.current
      const tool = deps.tool.current
      const pageId = deps.pageId.current
      if (deps.settings.current.autoShape && tool === 'pen') {
        const candidate = recognizeShape(points)
        if (candidate && candidate.score >= RECOGNIZE_THRESHOLD) {
          deps.controller.dispatch(
            addObjectCommand(
              pageId,
              createShape({
                kind: candidate.kind,
                x1: candidate.x1,
                y1: candidate.y1,
                x2: candidate.x2,
                y2: candidate.y2,
                color: style.color,
                width: style.width,
              }),
            ),
          )
          return
        }
      }
      deps.controller.dispatch(
        addObjectCommand(
          pageId,
          createStroke({
            tool: tool === 'highlighter' ? 'highlighter' : 'pen',
            color: style.color,
            width: style.width,
            smoothing: style.smoothing,
            points,
          }),
        ),
      )
    },
    cancelStroke: () => {
      livePoints = []
      api.renderer?.setLiveStroke(null)
    },

    beginShape: (kind, p) => {
      shapeKind = kind
      shapeStart = p
      setLiveShape(kind, p, p)
    },
    updateShape: (p) => {
      if (!shapeStart || !shapeKind) return
      setLiveShape(shapeKind, shapeStart, p)
    },
    endShape: (p) => {
      const start = shapeStart
      const kind = shapeKind
      shapeStart = null
      shapeKind = null
      api.renderer?.setLiveShape(null)
      if (!start || !kind) return
      const style = deps.style.current
      deps.controller.dispatch(
        addObjectCommand(
          deps.pageId.current,
          createShape({
            kind,
            x1: start.x,
            y1: start.y,
            x2: p.x,
            y2: p.y,
            color: style.color,
            width: style.width,
          }),
        ),
      )
    },
    cancelShape: () => {
      shapeStart = null
      shapeKind = null
      api.renderer?.setLiveShape(null)
    },

    beginErase: (p) => {
      erasingIds.clear()
      eraseCursor(p)
      eraseAt(p)
    },
    moveErase: (p) => {
      eraseCursor(p)
      eraseAt(p)
    },
    endErase: () => {
      if (erasingIds.size > 0) {
        const removed = currentPageObjects().filter((o) => erasingIds.has(o.id))
        if (removed.length > 0) {
          deps.controller.dispatch(removeObjectsCommand(deps.pageId.current, removed))
        }
      }
      clearErasePreview()
      eraseCursor(null)
    },
    cancelErase: () => {
      clearErasePreview()
      eraseCursor(null)
    },

    selectAt: (p, additive) => {
      const hit = pickTopmostObject(currentPageObjects(), p, PICK_TOLERANCE)
      if (!hit) {
        if (!additive && selectionIds.length > 0) {
          selectionIds = []
          api.renderer?.setSelection([])
        }
        return false
      }
      if (additive) {
        selectionIds = selectionIds.includes(hit.id)
          ? selectionIds.filter((id) => id !== hit.id)
          : [...selectionIds, hit.id]
      } else {
        selectionIds = [hit.id]
      }
      api.renderer?.setSelection(selectionIds)
      return true
    },
    beginMove: (p) => {
      const objs = currentPageObjects()
      const selected = objs.filter((o) => selectionIds.includes(o.id))
      const mb = unionBounds(selected)
      if (selected.length === 0 || !mb) return
      moveState = {
        ids: [...selectionIds],
        start: p,
        dx: 0,
        dy: 0,
        movingBounds: mb,
        others: objs.filter((o) => !selectionIds.includes(o.id)).map(objectBounds),
      }
    },
    moveBy: (p) => {
      const ms = moveState
      if (!ms) return
      let dx = p.x - ms.start.x
      let dy = p.y - ms.start.y
      const s = deps.settings.current
      if (s.snapEnabled && s.gridSize > 0) {
        dx = snapValue(ms.movingBounds.minX + dx, s.gridSize, true) - ms.movingBounds.minX
        dy = snapValue(ms.movingBounds.minY + dy, s.gridSize, true) - ms.movingBounds.minY
      }
      const guides = computeAlignmentGuides(ms.movingBounds, ms.others, ALIGNMENT_TOLERANCE)
      dx += guides.dx
      dy += guides.dy
      ms.dx = dx
      ms.dy = dy
      api.renderer?.setOffsetPreview(ms.ids, dx, dy)
      api.renderer?.setAlignmentOverlay({ guideXs: guides.guideXs, guideYs: guides.guideYs })
    },
    endMove: (commit) => {
      const ms = moveState
      moveState = null
      api.renderer?.setOffsetPreview([], 0, 0)
      api.renderer?.setAlignmentOverlay(null)
      if (ms && commit && (ms.dx !== 0 || ms.dy !== 0)) {
        deps.controller.dispatch(moveObjectsCommand(deps.pageId.current, ms.ids, ms.dx, ms.dy))
      }
    },

    updateCursor: (p) => {
      eraseCursor(deps.tool.current === 'eraser' ? p : null)
    },

    getZoom: () => view.zoom,
    zoomTo: (zoom) => {
      const target = zoomView(view, centerScreen(), zoom / (view.zoom > 0 ? view.zoom : 1))
      setView(target)
    },
    zoomByFactor: (factor) => {
      setView(zoomView(view, centerScreen(), factor))
    },
    clearSelection: () => {
      selectionIds = []
      api.renderer?.setSelection([])
    },
    deleteSelection: () => {
      if (selectionIds.length === 0) return false
      const removed = currentPageObjects().filter((o) => selectionIds.includes(o.id))
      if (removed.length === 0) return false
      deps.controller.dispatch(removeObjectsCommand(deps.pageId.current, removed))
      selectionIds = []
      api.renderer?.setSelection([])
      return true
    },
  }

  return api
}
