import { describe, expect, it } from 'vitest'
import { recognizeShape } from '../src/geometry/ShapeRecognizer'
import type { SampledPoint } from '../src/documents/DocumentModel'

function samplePath(points: Array<[number, number]>, step = 3): SampledPoint[] {
  const out: SampledPoint[] = []
  for (let i = 0; i < points.length - 1; i++) {
    const [x1, y1] = points[i] as [number, number]
    const [x2, y2] = points[i + 1] as [number, number]
    const segLen = Math.hypot(x2 - x1, y2 - y1)
    const n = Math.max(1, Math.round(segLen / step))
    for (let k = 0; k < n; k++) {
      const f = k / n
      out.push({ x: x1 + (x2 - x1) * f, y: y1 + (y2 - y1) * f, t: out.length })
    }
  }
  const last = points[points.length - 1]
  if (last) out.push({ x: last[0], y: last[1], t: out.length })
  return out
}

describe('ShapeRecognizer', () => {
  it('recognizes straight lines (horizontal, vertical, diagonal)', () => {
    const h = recognizeShape(samplePath([[0, 100], [200, 100]]))
    expect(h?.kind).toBe('line')
    const v = recognizeShape(samplePath([[50, 0], [50, 180]]))
    expect(v?.kind).toBe('line')
    const d = recognizeShape(samplePath([[0, 0], [150, 150]]))
    expect(d?.kind).toBe('line')
  })

  it('recognizes a closed rectangle', () => {
    // Drawn like a human: start at a corner, loop around, overshoot slightly
    // past the start corner along the first edge. An exactly-closed path or a
    // diagonal tail would collapse the 4th corner out of the interior vertices.
    const rect = recognizeShape(
      samplePath(
        [
          [0, 0],
          [120, 0],
          [120, 120],
          [0, 120],
          [0, 0],
          [10, 0],
        ],
        3,
      ),
    )
    expect(rect?.kind).toBe('rectangle')
  })

  it('recognizes a circle as an ellipse', () => {
    const pts: SampledPoint[] = []
    const n = 120
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2
      pts.push({ x: 100 + 60 * Math.cos(a), y: 100 + 60 * Math.sin(a), t: i })
    }
    pts.push({ ...pts[0]!, t: n })
    const ell = recognizeShape(pts)
    expect(ell?.kind).toBe('ellipse')
  })

  it('keeps a squiggle freehand (null)', () => {
    const pts: SampledPoint[] = []
    for (let i = 0; i <= 60; i++) {
      pts.push({ x: i * 4, y: 50 + 45 * Math.sin(i / 3), t: i })
    }
    expect(recognizeShape(pts)).toBeNull()
  })

  it('ignores tiny gestures', () => {
    const few: SampledPoint[] = [
      { x: 0, y: 0, t: 0 },
      { x: 10, y: 0, t: 1 },
      { x: 20, y: 0, t: 2 },
    ]
    expect(recognizeShape(few)).toBeNull()
  })
})
