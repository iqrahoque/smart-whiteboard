import { describe, expect, it } from 'vitest'
import { pathLength, processRawSamples } from '../src/ink/StrokeProcessor'
import type { SampledPoint } from '../src/documents/DocumentModel'

function line(y: (x: number) => number, n: number, t0 = 0): SampledPoint[] {
  const out: SampledPoint[] = []
  for (let i = 0; i < n; i++) out.push({ x: i * 10, y: y(i * 10), t: t0 + i })
  return out
}

describe('StrokeProcessor', () => {
  it('rejects non-finite samples', () => {
    const raw: SampledPoint[] = [
      { x: 0, y: 0, t: 0 },
      { x: Number.NaN, y: 5, t: 1 },
      { x: 10, y: Number.POSITIVE_INFINITY, t: 2 },
      { x: 10, y: 5, t: 3 },
    ]
    const out = processRawSamples(raw, 'balanced')
    expect(out.length).toBeGreaterThanOrEqual(2)
    for (const p of out) {
      expect(Number.isFinite(p.x)).toBe(true)
      expect(Number.isFinite(p.y)).toBe(true)
    }
  })

  it('returns empty for empty or fully-invalid input', () => {
    expect(processRawSamples([], 'balanced')).toEqual([])
    expect(processRawSamples([{ x: Number.NaN, y: 0, t: 0 }], 'low')).toEqual([])
  })

  it('de-duplicates near-identical consecutive samples', () => {
    const raw: SampledPoint[] = [
      { x: 0, y: 0, t: 0 },
      { x: 0.1, y: 0, t: 1 },
      { x: 0.2, y: 0, t: 2 },
      { x: 50, y: 0, t: 3 },
    ]
    const out = processRawSamples(raw, 'balanced')
    expect(out.length).toBe(2)
  })

  it('re-anchors the smoothed endpoints to the raw gesture', () => {
    const raw = line(() => 0, 10)
    raw[0] = { x: 0, y: 7, t: 0 }
    const last = raw[raw.length - 1]
    if (last) last.y = -3
    const out = processRawSamples(raw, 'high')
    expect(out[0]?.y).toBe(7)
    expect(out[out.length - 1]?.y).toBe(-3)
  })

  it('smoothes more aggressively on the high preset than on low', () => {
    const jagged = line((x) => (Math.floor(x / 10) % 2 === 0 ? 0 : 14), 21)
    const low = processRawSamples(jagged, 'low')
    const high = processRawSamples(jagged, 'high')
    const maxDev = (pts: SampledPoint[]): number =>
      Math.max(...pts.slice(1, -1).map((p) => Math.abs(p.y)))
    expect(maxDev(high)).toBeLessThan(maxDev(low))
  })

  it('measures polyline length', () => {
    const pts: SampledPoint[] = [
      { x: 0, y: 0, t: 0 },
      { x: 3, y: 4, t: 1 },
      { x: 3, y: 4, t: 2 },
    ]
    expect(pathLength(pts)).toBeCloseTo(5, 10)
  })
})
