/**
 * Screen ⇄ document coordinate transforms.
 *
 * Document space is the stable coordinate system of stored geometry; screen
 * space is CSS pixels relative to the canvas element. The mapping is:
 *
 *   screenCss = (doc + pan) * zoom
 *   doc       = screenCss / zoom − pan
 *
 * Device pixel ratio is handled at the canvas-buffer level (the renderer sizes
 * the backing store to cssSize × dpr); these transforms stay in CSS pixels and
 * are therefore unaffected by browser zoom or DPR changes.
 */

import type { Point } from '../documents/DocumentModel'

export interface ViewTransform {
  zoom: number
  panX: number
  panY: number
}

export interface CanvasRect {
  left: number
  top: number
  width: number
  height: number
}

export const MIN_ZOOM = 0.2
export const MAX_ZOOM = 5

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))
}

/** Convert a client-space pointer position into canvas-local CSS pixels. */
export function clientToCanvas(clientX: number, clientY: number, rect: CanvasRect): Point {
  return { x: clientX - rect.left, y: clientY - rect.top }
}

export function screenToDocument(screenX: number, screenY: number, view: ViewTransform): Point {
  return { x: screenX / view.zoom - view.panX, y: screenY / view.zoom - view.panY }
}

export function documentToScreen(docX: number, docY: number, view: ViewTransform): Point {
  return { x: (docX + view.panX) * view.zoom, y: (docY + view.panY) * view.zoom }
}

/**
 * Zoom while keeping the document point under `screen` fixed on screen.
 * Pure: returns the next view; callers decide whether to store it.
 */
export function zoomView(view: ViewTransform, screen: Point, factor: number): ViewTransform {
  const zoom = clampZoom(view.zoom * factor)
  const before = screenToDocument(screen.x, screen.y, view)
  const after = screenToDocument(screen.x, screen.y, { ...view, zoom })
  // Keep the document point under `screen` fixed: pan' = pan + (after − before)
  // (follows from screen = (doc + pan) · zoom solved at a fixed screen point).
  return { zoom, panX: view.panX + (after.x - before.x), panY: view.panY + (after.y - before.y) }
}

/**
 * Size a canvas backing store for the current DPR. Returns true when the
 * buffer changed (caller should repaint).
 */
export function sizeCanvasBuffer(
  canvas: HTMLCanvasElement,
  widthCss: number,
  heightCss: number,
  dpr: number,
): boolean {
  const w = Math.max(1, Math.round(widthCss * dpr))
  const h = Math.max(1, Math.round(heightCss * dpr))
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w
    canvas.height = h
    canvas.style.width = `${widthCss}px`
    canvas.style.height = `${heightCss}px`
    return true
  }
  return false
}
