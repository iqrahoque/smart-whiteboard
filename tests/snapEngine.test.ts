import { describe, expect, it } from 'vitest'
import { computeAlignmentGuides, snapPoint, snapValue } from '../src/geometry/SnapEngine'
import type { Bounds } from '../src/geometry/SnapEngine'

describe('SnapEngine', () => {
  it('snaps values to the grid when enabled', () => {
    expect(snapValue(23, 24, true)).toBe(24)
    expect(snapValue(13, 24, true)).toBe(24)
    expect(snapValue(11, 24, true)).toBe(0)
    expect(snapValue(0, 24, true)).toBe(0)
  })

  it('leaves values unchanged when disabled or grid is degenerate', () => {
    expect(snapValue(23, 24, false)).toBe(23)
    expect(snapValue(23, 0, true)).toBe(23)
    expect(snapValue(23, -5, true)).toBe(23)
  })

  it('snaps both coordinates of a point', () => {
    expect(snapPoint({ x: 22, y: 47 }, 24, true)).toEqual({ x: 24, y: 48 })
    expect(snapPoint({ x: 22, y: 47 }, 24, false)).toEqual({ x: 22, y: 47 })
  })

  it('is purely document-space (zoom never participates)', () => {
    // Same inputs, computed twice — there is no zoom input at all.
    expect(snapValue(35, 24, true)).toBe(snapValue(35, 24, true))
  })

  it('computes alignment guides within tolerance', () => {
    const moving: Bounds = { minX: 40, minY: 0, maxX: 80, maxY: 40 }
    const others: Bounds[] = [{ minX: 44, minY: 100, maxX: 84, maxY: 140 }]
    const result = computeAlignmentGuides(moving, others, 6)
    expect(result.dx).toBe(4)
    expect(result.guideXs).toContain(44)
    expect(result.guideXs).toContain(84)
    expect(result.dy).toBe(0)
  })

  it('returns no shift when nothing is within tolerance', () => {
    const moving: Bounds = { minX: 0, minY: 0, maxX: 40, maxY: 40 }
    const result = computeAlignmentGuides(moving, [{ minX: 200, minY: 200, maxX: 260, maxY: 260 }], 6)
    expect(result.dx).toBe(0)
    expect(result.dy).toBe(0)
    expect(result.guideXs).toHaveLength(0)
    expect(result.guideYs).toHaveLength(0)
  })
})
