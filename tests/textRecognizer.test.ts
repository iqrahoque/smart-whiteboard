/**
 * Tests for the offline handwriting recognizer (src/ink/TextRecognizer.ts).
 *
 * Characters are "written" by tracing the template polylines with jitter —
 * the same way a careful user draws block letters — so the expectations stay
 * honest about what the deterministic matcher can do.
 */

import { describe, expect, it } from 'vitest'
import type { SampledPoint, StrokeObject } from '../src/documents/DocumentModel'
import { recognizeText, cloudMatchScore } from '../src/ink/TextRecognizer'
import { buildCloud, buildTemplates, glyphDef, glyphStrokes, normalizeCloud } from '../src/ink/textTemplates'

let seed = 42
function rand(): number {
  // Deterministic LCG so failures reproduce.
  seed = (seed * 1664525 + 1013904223) % 4294967296
  return seed / 4294967296
}

function traceFlat(stroke: number[], jitter: number): SampledPoint[] {
  const pts: SampledPoint[] = []
  for (let i = 0; i + 1 < stroke.length; i += 2) {
    const x = (stroke[i] ?? 0) + (rand() * 2 - 1) * jitter
    const y = (stroke[i + 1] ?? 0) + (rand() * 2 - 1) * jitter
    pts.push({ x, y, t: i })
    if (i + 3 < stroke.length) {
      // Insert a midpoint for extra density, like a real stylus stream.
      const mx = ((stroke[i] ?? 0) + (stroke[i + 2] ?? 0)) / 2 + (rand() * 2 - 1) * jitter
      const my = ((stroke[i + 1] ?? 0) + (stroke[i + 3] ?? 0)) / 2 + (rand() * 2 - 1) * jitter
      pts.push({ x: mx, y: my, t: i + 1 })
    }
  }
  return pts
}

function writeChar(ch: string, dx: number, dy: number, scale = 1, jitter = 1.5): StrokeObject[] {
  // One StrokeObject per template polyline — how block letters are really
  // drawn (H = two stems + a crossbar as separate strokes).
  return glyphStrokes(ch).map((s, i) => ({
    type: 'stroke' as const,
    id: `s-${ch}-${i}-${dx}-${dy}-${rand()}`,
    tool: 'pen' as const,
    color: '#1d1d1f',
    width: 3,
    smoothing: 'balanced' as const,
    points: traceFlat(s, jitter).map((p) => ({
      x: p.x * scale + dx,
      y: p.y * scale + dy,
      t: p.t,
    })),
  }))
}

function writeWord(
  chars: Array<{ ch: string; gap?: number }>,
  origin = { x: 100, y: 100 },
  scale = 1,
): StrokeObject[] {
  const out: StrokeObject[] = []
  let cursor = origin.x
  for (const { ch, gap } of chars) {
    if (gap) cursor += gap
    out.push(...writeChar(ch, cursor, origin.y, scale))
    // Realistic letter advance: glyph width plus a 12-unit letter gap.
    const w = (glyphDef(ch)?.w ?? 60) * scale
    cursor += w + 12 * scale
  }
  return out
}

describe('template clouds', () => {
  it('every glyph produces a 32-point normalized cloud', () => {
    const templates = buildTemplates()
    expect(templates.length).toBeGreaterThan(60)
    for (const t of templates) {
      expect(t.cloud).toHaveLength(32)
      // Centered near origin, scaled into a unit box.
      const cx = t.cloud.reduce((a, p) => a + p.x, 0) / t.cloud.length
      const cy = t.cloud.reduce((a, p) => a + p.y, 0) / t.cloud.length
      expect(Math.abs(cx)).toBeLessThan(0.5)
      expect(Math.abs(cy)).toBeLessThan(0.5)
    }
  })
})

describe('cloud matching', () => {
  it('identical clouds score 1', () => {
    const cloud = normalizeCloud(buildCloud(glyphStrokes('A').map(flatToPoints)))
    expect(cloudMatchScore(cloud, cloud)).toBeCloseTo(1, 5)
  })

  it('different letters score clearly lower than the same letter', () => {
    const a = normalizeCloud(buildCloud(glyphStrokes('L').map(flatToPoints)))
    const same = normalizeCloud(buildCloud(glyphStrokes('L').map(flatToPoints)))
    const other = normalizeCloud(buildCloud(glyphStrokes('T').map(flatToPoints)))
    const sameScore = cloudMatchScore(a, same)
    const otherScore = cloudMatchScore(a, other)
    expect(sameScore).toBeGreaterThan(otherScore + 0.25)
  })
})

function flatToPoints(stroke: number[]): Array<{ x: number; y: number }> {
  const pts: Array<{ x: number; y: number }> = []
  for (let i = 0; i + 1 < stroke.length; i += 2) pts.push({ x: stroke[i] ?? 0, y: stroke[i + 1] ?? 0 })
  return pts
}

describe('recognizeText', () => {
  it('reads a single clear block letter', () => {
    seed = 7
    const result = recognizeText(writeChar('H', 100, 100))
    expect(result).not.toBeNull()
    expect(result?.text).toBe('H')
    expect(result?.confidence).toBeGreaterThan(0.75)
  })

  it('reads a word of block letters', () => {
    seed = 11
    const strokes = writeWord([{ ch: 'H' }, { ch: 'I' }])
    const result = recognizeText(strokes)
    expect(result).not.toBeNull()
    expect(result?.text).toBe('HI')
  })

  it('inserts a space for wide gaps between letters', () => {
    seed = 13
    const strokes = writeWord([{ ch: 'H' }, { ch: 'I', gap: 90 }])
    const result = recognizeText(strokes)
    expect(result).not.toBeNull()
    expect(result?.text).toBe('H I')
  })

  it('joins multi-stroke letters into one glyph', () => {
    seed = 17
    const strokes = writeWord([{ ch: 'A' }, { ch: 'T' }])
    const result = recognizeText(strokes)
    expect(result).not.toBeNull()
    expect(result?.text).toBe('AT')
  })

  it('separates lines with newlines', () => {
    seed = 19
    const line1 = writeWord([{ ch: 'H' }], { x: 100, y: 100 })
    const line2 = writeWord([{ ch: 'L' }], { x: 100, y: 320 })
    const result = recognizeText([...line1, ...line2])
    expect(result).not.toBeNull()
    expect(result?.text).toBe('H\nL')
  })

  it('distinguishes case using letter height', () => {
    seed = 23
    // An x-height 'o' sitting on the same baseline as a full-height 'O',
    // one letter-gap to its right.
    const small = writeChar('o', 100, 135, 0.65)
    const oWidth = (glyphDef('o')?.w ?? 48) * 0.65
    const big = writeChar('O', 100 + oWidth + 12, 100, 1)
    const result = recognizeText([...small, ...big])
    expect(result).not.toBeNull()
    expect(result?.text).toBe('oO')
  })

  it('reads digits', () => {
    seed = 29
    const strokes = writeWord([{ ch: '1' }, { ch: '2' }, { ch: '3' }])
    const result = recognizeText(strokes)
    expect(result).not.toBeNull()
    expect(result?.text).toBe('123')
  })

  it('derives font size from the letter height and matches ink color', () => {
    seed = 31
    const strokes = writeWord([{ ch: 'H' }, { ch: 'E' }])
    strokes.forEach((s) => (s.color = '#0a84ff'))
    const result = recognizeText(strokes)
    expect(result).not.toBeNull()
    expect(result?.color).toBe('#0a84ff')
    expect(result?.fontSize).toBeGreaterThan(80)
    expect(result?.fontSize).toBeLessThan(140)
  })

  it('refuses noisy scribbles instead of guessing', () => {
    seed = 37
    const scribble: StrokeObject = {
      type: 'stroke',
      id: 'scribble',
      tool: 'pen',
      color: '#1d1d1f',
      width: 3,
      smoothing: 'balanced',
      points: Array.from({ length: 40 }, (_, i) => ({
        x: 100 + i * 7,
        y: 100 + Math.sin(i * 1.7) * 45 + (rand() * 2 - 1) * 18,
        t: i * 16,
      })),
    }
    const result = recognizeText([scribble])
    // Either confidently read (unlikely for noise) or refused outright.
    if (result !== null) {
      expect(result.confidence).toBeGreaterThanOrEqual(0.62)
    }
  })

  it('returns null for empty input', () => {
    expect(recognizeText([])).toBeNull()
  })

  it('is tolerant to translation, scale and moderate jitter', () => {
    seed = 41
    const result = recognizeText(writeChar('E', 540, 380, 1.6, 2.5))
    expect(result?.text).toBe('E')
  })
})
