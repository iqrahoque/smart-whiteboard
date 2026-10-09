/**
 * Grid snapping and alignment guides (brief §8). All functions operate in
 * document space and are therefore zoom-independent by construction.
 */

import type { Point } from '../documents/DocumentModel'

export interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/** Snap a single coordinate to the grid. Disabled → unchanged. */
export function snapValue(value: number, grid: number, enabled: boolean): number {
  if (!enabled || grid <= 0) return value
  return Math.round(value / grid) * grid
}

export function snapPoint(p: Point, grid: number, enabled: boolean): Point {
  if (!enabled || grid <= 0) return p
  return { x: snapValue(p.x, grid, true), y: snapValue(p.y, grid, true) }
}

export interface AlignmentResult {
  /** Shift to apply to the moving bounds to reach the best alignment. */
  dx: number
  dy: number
  /** Document-space x positions of vertical guides to draw. */
  guideXs: number[]
  /** Document-space y positions of horizontal guides to draw. */
  guideYs: number[]
}

/**
 * Find the smallest-shift alignment of the moving bounds against other
 * objects: min/center/max on each axis, within tolerance (document units).
 * Pure and zoom-independent.
 */
export function computeAlignmentGuides(
  moving: Bounds,
  others: readonly Bounds[],
  tolerance: number,
): AlignmentResult {
  let bestDx = 0
  let bestDy = 0
  let bestAbsDx = Infinity
  let bestAbsDy = Infinity
  const guideXs: number[] = []
  const guideYs: number[] = []

  const movingCenterX = (moving.minX + moving.maxX) / 2
  const movingCenterY = (moving.minY + moving.maxY) / 2

  for (const o of others) {
    const oCenterX = (o.minX + o.maxX) / 2
    const oCenterY = (o.minY + o.maxY) / 2
    const candidatesX: Array<[number, number]> = [
      [o.minX - moving.minX, o.minX],
      [oCenterX - movingCenterX, oCenterX],
      [o.maxX - moving.maxX, o.maxX],
    ]
    const candidatesY: Array<[number, number]> = [
      [o.minY - moving.minY, o.minY],
      [oCenterY - movingCenterY, oCenterY],
      [o.maxY - moving.maxY, o.maxY],
    ]
    for (const [d, guide] of candidatesX) {
      const abs = Math.abs(d)
      if (abs <= tolerance && abs < bestAbsDx) {
        bestAbsDx = abs
        bestDx = d
        guideXs.length = 0
        guideXs.push(guide)
      } else if (abs <= tolerance && abs === bestAbsDx && d === bestDx) {
        guideXs.push(guide)
      }
    }
    for (const [d, guide] of candidatesY) {
      const abs = Math.abs(d)
      if (abs <= tolerance && abs < bestAbsDy) {
        bestAbsDy = abs
        bestDy = d
        guideYs.length = 0
        guideYs.push(guide)
      } else if (abs <= tolerance && abs === bestAbsDy && d === bestDy) {
        guideYs.push(guide)
      }
    }
  }

  return {
    dx: Number.isFinite(bestAbsDx) ? bestDx : 0,
    dy: Number.isFinite(bestAbsDy) ? bestDy : 0,
    guideXs,
    guideYs,
  }
}
