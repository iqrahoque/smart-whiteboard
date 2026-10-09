/**
 * Pure canvas painting of backgrounds and page objects, shared by the live
 * renderer and the PNG export service. All functions take a canvas context
 * already transformed so that 1 unit = 1 CSS pixel of the target surface.
 *
 * Backgrounds are painted in screen space with device-pixel alignment so
 * ruled/dotted/grid patterns stay crisp at any zoom without moiré.
 */

import type { PageDoc, PageObject, ShapeObject, StrokeObject } from '../documents/DocumentModel'
import type { ViewTransform } from './CoordinateSystem'

export const GRID_SPACING = 24
export const RULED_SPACING = 28
export const DOT_SPACING = 24

function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return hex
  const n = parseInt(m[1] ?? '000000', 16)
  const r = (n >> 16) & 0xff
  const g = (n >> 8) & 0xff
  const b = n & 0xff
  return `rgba(${r},${g},${b},${alpha})`
}

/** Effective visual alpha for a stroke: highlighters are translucent ink. */
export function strokeAlpha(obj: StrokeObject): number {
  return obj.tool === 'highlighter' ? 0.35 : 1
}

export function paintBackground(
  ctx: CanvasRenderingContext2D,
  page: PageDoc,
  view: ViewTransform,
  dpr: number,
  widthCss: number,
  heightCss: number,
): void {
  ctx.save()
  ctx.fillStyle = page.paperColor
  ctx.fillRect(0, 0, widthCss, heightCss)

  const spacing =
    page.background === 'ruled' ? RULED_SPACING : page.background === 'blank' ? 0 : DOT_SPACING
  if (spacing <= 0) {
    ctx.restore()
    return
  }

  // Anti-moiré: coarsen the pattern when it would be denser than ~5 px.
  let sp = spacing
  while (sp * view.zoom < 5) sp *= 2

  // Visible document-space range.
  const docLeft = -view.panX
  const docTop = -view.panY
  const docRight = docLeft + widthCss / view.zoom
  const docBottom = docTop + heightCss / view.zoom

  ctx.strokeStyle = hexToRgba('#7f7f8f', 0.5)
  ctx.fillStyle = hexToRgba('#7f7f8f', 0.55)
  ctx.lineWidth = 1

  if (page.background === 'dotted') {
    const r = view.zoom > 1.6 ? 2 : 1.25
    for (let y = Math.floor(docTop / sp) * sp; y <= docBottom; y += sp) {
      const sy = Math.round((y + view.panY) * view.zoom * dpr) / dpr
      for (let x = Math.floor(docLeft / sp) * sp; x <= docRight; x += sp) {
        const sx = Math.round((x + view.panX) * view.zoom * dpr) / dpr
        ctx.beginPath()
        ctx.arc(sx, sy, r, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  } else if (page.background === 'grid') {
    for (let x = Math.floor(docLeft / sp) * sp; x <= docRight; x += sp) {
      const sx = Math.round((x + view.panX) * view.zoom * dpr) / dpr
      ctx.beginPath()
      ctx.moveTo(sx, 0)
      ctx.lineTo(sx, heightCss)
      ctx.stroke()
    }
    for (let y = Math.floor(docTop / sp) * sp; y <= docBottom; y += sp) {
      const sy = Math.round((y + view.panY) * view.zoom * dpr) / dpr
      ctx.beginPath()
      ctx.moveTo(0, sy)
      ctx.lineTo(widthCss, sy)
      ctx.stroke()
    }
  } else if (page.background === 'ruled') {
    for (let y = Math.floor(docTop / sp) * sp; y <= docBottom; y += sp) {
      const sy = Math.round((y + view.panY) * view.zoom * dpr) / dpr
      ctx.beginPath()
      ctx.moveTo(0, sy)
      ctx.lineTo(widthCss, sy)
      ctx.stroke()
    }
  }
  ctx.restore()
}

export function paintStroke(ctx: CanvasRenderingContext2D, obj: StrokeObject): void {
  const pts = obj.points
  if (pts.length === 0) return
  ctx.save()
  ctx.strokeStyle = obj.color
  ctx.globalAlpha = strokeAlpha(obj)
  ctx.lineWidth = obj.width
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  if (pts.length === 1) {
    const p0 = pts[0]
    if (p0) {
      ctx.beginPath()
      ctx.arc(p0.x, p0.y, obj.width / 2, 0, Math.PI * 2)
      ctx.fillStyle = obj.color
      ctx.fill()
    }
    ctx.restore()
    return
  }
  ctx.beginPath()
  const firstPt = pts[0]
  if (!firstPt) {
    ctx.restore()
    return
  }
  ctx.moveTo(firstPt.x, firstPt.y)
  // Quadratic-through-midpoints: smooth joins without rounding off endpoints.
  for (let i = 1; i < pts.length - 1; i++) {
    const cur = pts[i]
    const next = pts[i + 1]
    if (!cur || !next) continue
    ctx.quadraticCurveTo(cur.x, cur.y, (cur.x + next.x) / 2, (cur.y + next.y) / 2)
  }
  const last = pts[pts.length - 1]
  if (last) ctx.lineTo(last.x, last.y)
  ctx.stroke()
  ctx.restore()
}

export function paintShape(ctx: CanvasRenderingContext2D, obj: ShapeObject): void {
  ctx.save()
  ctx.strokeStyle = obj.color
  ctx.lineWidth = obj.width
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  const minX = Math.min(obj.x1, obj.x2)
  const minY = Math.min(obj.y1, obj.y2)
  const maxX = Math.max(obj.x1, obj.x2)
  const maxY = Math.max(obj.y1, obj.y2)
  switch (obj.kind) {
    case 'line':
      ctx.moveTo(obj.x1, obj.y1)
      ctx.lineTo(obj.x2, obj.y2)
      ctx.stroke()
      break
    case 'rectangle':
      ctx.rect(minX, minY, maxX - minX, maxY - minY)
      ctx.stroke()
      break
    case 'ellipse': {
      ctx.ellipse((minX + maxX) / 2, (minY + maxY) / 2, (maxX - minX) / 2, (maxY - minY) / 2, 0, 0, Math.PI * 2)
      ctx.stroke()
      break
    }
    case 'arrow': {
      ctx.moveTo(obj.x1, obj.y1)
      ctx.lineTo(obj.x2, obj.y2)
      ctx.stroke()
      const angle = Math.atan2(obj.y2 - obj.y1, obj.x2 - obj.x1)
      const head = Math.max(12, obj.width * 4)
      const spread = Math.PI / 7
      ctx.beginPath()
      ctx.moveTo(obj.x2, obj.y2)
      ctx.lineTo(obj.x2 - head * Math.cos(angle - spread), obj.y2 - head * Math.sin(angle - spread))
      ctx.moveTo(obj.x2, obj.y2)
      ctx.lineTo(obj.x2 - head * Math.cos(angle + spread), obj.y2 - head * Math.sin(angle + spread))
      ctx.stroke()
      break
    }
  }
  ctx.restore()
}

export function paintObject(ctx: CanvasRenderingContext2D, obj: PageObject): void {
  if (obj.type === 'stroke') paintStroke(ctx, obj)
  else paintShape(ctx, obj)
}

/** Paint a page (background + objects) into an arbitrary context/viewport. */
export function paintPage(
  ctx: CanvasRenderingContext2D,
  page: PageDoc,
  view: ViewTransform,
  dpr: number,
  widthCss: number,
  heightCss: number,
): void {
  paintBackground(ctx, page, view, dpr, widthCss, heightCss)
  ctx.save()
  ctx.setTransform(
    view.zoom * dpr,
    0,
    0,
    view.zoom * dpr,
    view.panX * view.zoom * dpr,
    view.panY * view.zoom * dpr,
  )
  for (const obj of page.objects) paintObject(ctx, obj)
  ctx.restore()
}
