import { describe, expect, it } from 'vitest'
import {
  clampZoom,
  documentToScreen,
  screenToDocument,
  zoomView,
} from '../src/canvas/CoordinateSystem'
import type { ViewTransform } from '../src/canvas/CoordinateSystem'

const view: ViewTransform = { zoom: 1.5, panX: 3, panY: -2 }

describe('CoordinateSystem', () => {
  it('round-trips document → screen → document', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 123.5, y: -87.25 },
      { x: -40, y: 40 },
    ]
    for (const p of points) {
      const s = documentToScreen(p.x, p.y, view)
      const back = screenToDocument(s.x, s.y, view)
      expect(back.x).toBeCloseTo(p.x, 10)
      expect(back.y).toBeCloseTo(p.y, 10)
    }
  })

  it('keeps the document point under the cursor fixed while zooming', () => {
    const start: ViewTransform = { zoom: 1, panX: 0, panY: 0 }
    const screen = { x: 100, y: 50 }
    const docBefore = screenToDocument(screen.x, screen.y, start)
    const next = zoomView(start, screen, 2)
    const docAfter = screenToDocument(screen.x, screen.y, next)
    expect(docAfter.x).toBeCloseTo(docBefore.x, 10)
    expect(docAfter.y).toBeCloseTo(docBefore.y, 10)
    expect(next.zoom).toBe(2)
  })

  it('clamps zoom into the supported range', () => {
    expect(clampZoom(10)).toBe(5)
    expect(clampZoom(0.01)).toBe(0.2)
    expect(clampZoom(Number.NaN)).toBe(1)
    expect(clampZoom(1)).toBe(1)
  })
})
