/**
 * Geometric hit testing for the eraser and selection tools. Tolerances are in
 * document units and scale with object width so thin ink stays pickable.
 */

import type { PageObject, Point, ShapeObject, StrokeObject } from '../documents/DocumentModel'
import { objectBounds } from '../documents/DocumentModel'

export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lengthSq = dx * dx + dy * dy
  if (lengthSq === 0) return Math.hypot(p.x - a.x, p.y - a.y)
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

function hitTestStroke(stroke: StrokeObject, p: Point, tol: number): boolean {
  const threshold = tol + stroke.width / 2
  if (stroke.points.length === 1) {
    const only = stroke.points[0]
    return only ? Math.hypot(p.x - only.x, p.y - only.y) <= threshold : false
  }
  for (let i = 1; i < stroke.points.length; i++) {
    const a = stroke.points[i - 1]
    const b = stroke.points[i]
    if (!a || !b) continue
    if (distanceToSegment(p, a, b) <= threshold) return true
  }
  return false
}

function arrowHeadHit(shape: ShapeObject, p: Point, threshold: number): boolean {
  const angle = Math.atan2(shape.y2 - shape.y1, shape.x2 - shape.x1)
  const head = Math.max(12, shape.width * 4)
  const spread = Math.PI / 7
  const tip = { x: shape.x2, y: shape.y2 }
  const wing1 = { x: tip.x - head * Math.cos(angle - spread), y: tip.y - head * Math.sin(angle - spread) }
  const wing2 = { x: tip.x - head * Math.cos(angle + spread), y: tip.y - head * Math.sin(angle + spread) }
  return (
    distanceToSegment(p, tip, wing1) <= threshold || distanceToSegment(p, tip, wing2) <= threshold
  )
}

/**
 * Hit test a shape. `mode = 'border'` (eraser) only accepts the drawn ink;
 * `mode = 'area'` (selection) also accepts the interior of closed shapes.
 */
function hitTestShape(shape: ShapeObject, p: Point, tol: number, mode: 'border' | 'area'): boolean {
  const threshold = tol + shape.width / 2
  switch (shape.kind) {
    case 'line':
      return distanceToSegment(p, { x: shape.x1, y: shape.y1 }, { x: shape.x2, y: shape.y2 }) <= threshold
    case 'arrow':
      return (
        distanceToSegment(p, { x: shape.x1, y: shape.y1 }, { x: shape.x2, y: shape.y2 }) <= threshold ||
        arrowHeadHit(shape, p, threshold)
      )
    case 'rectangle': {
      const minX = Math.min(shape.x1, shape.x2)
      const maxX = Math.max(shape.x1, shape.x2)
      const minY = Math.min(shape.y1, shape.y2)
      const maxY = Math.max(shape.y1, shape.y2)
      const inside = p.x > minX && p.x < maxX && p.y > minY && p.y < maxY
      if (mode === 'area' && inside) return true
      // Distance to the nearest border point.
      const nearestX = Math.max(minX, Math.min(p.x, maxX))
      const nearestY = Math.max(minY, Math.min(p.y, maxY))
      return Math.hypot(p.x - nearestX, p.y - nearestY) <= threshold
    }
    case 'ellipse': {
      const cx = (shape.x1 + shape.x2) / 2
      const cy = (shape.y1 + shape.y2) / 2
      const rx = Math.abs(shape.x2 - shape.x1) / 2
      const ry = Math.abs(shape.y2 - shape.y1) / 2
      if (rx === 0 || ry === 0) return false
      const norm = Math.sqrt(((p.x - cx) / rx) ** 2 + ((p.y - cy) / ry) ** 2)
      if (mode === 'area' && norm <= 1) return true
      // Approximate border distance in the flatter axis.
      return Math.abs(norm - 1) * Math.min(rx, ry) <= threshold
    }
  }
}

export function hitTestObject(
  obj: PageObject,
  p: Point,
  tol: number,
  mode: 'border' | 'area',
): boolean {
  if (obj.type === 'stroke') return hitTestStroke(obj, p, tol)
  return hitTestShape(obj, p, tol, mode)
}

/** Topmost object under the point (z-order = array order), or null. */
export function pickTopmostObject(
  objects: readonly PageObject[],
  p: Point,
  tol: number,
): PageObject | null {
  for (let i = objects.length - 1; i >= 0; i--) {
    const obj = objects[i]
    if (obj && hitTestObject(obj, p, tol, 'area')) return obj
  }
  return null
}

/** Objects whose bounds intersect the document-space rectangle. */
export function objectsIntersectingRect(objects: readonly PageObject[], rect: BoundsLike): PageObject[] {
  const minX = Math.min(rect.x1, rect.x2)
  const maxX = Math.max(rect.x1, rect.x2)
  const minY = Math.min(rect.y1, rect.y2)
  const maxY = Math.max(rect.y1, rect.y2)
  return objects.filter((obj) => {
    const b = objectBounds(obj)
    return b.maxX >= minX && b.minX <= maxX && b.maxY >= minY && b.minY <= maxY
  })
}

interface BoundsLike {
  x1: number
  y1: number
  x2: number
  y2: number
}
