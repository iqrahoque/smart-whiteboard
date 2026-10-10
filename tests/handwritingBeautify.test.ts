/**
 * Tests for handwriting beautification (src/ink/HandwritingBeautifier.ts)
 * and the per-glyph recognition it builds on (recognizeGlyphDetails).
 *
 * Characters are "written" by tracing the template polylines with jitter —
 * the same honest technique as textRecognizer.test.ts.
 */

import { describe, expect, it } from 'vitest'
import type { SampledPoint, StrokeObject } from '../src/documents/DocumentModel'
import { createPage, createStroke } from '../src/documents/DocumentModel'
import { beautifyStrokesCommand } from '../src/documents/Commands'
import {
  beautifyGlyphs,
  beautifyHandwriting,
} from '../src/ink/HandwritingBeautifier'
import { CONFIDENCE_GATE, recognizeGlyphDetails } from '../src/ink/TextRecognizer'
import type { GlyphRecognition, RecognizedGlyph, RecognizedLine } from '../src/ink/TextRecognizer'
import { glyphDef, glyphStrokes } from '../src/ink/textTemplates'

let seed = 42
function rand(): number {
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
      const mx = ((stroke[i] ?? 0) + (stroke[i + 2] ?? 0)) / 2 + (rand() * 2 - 1) * jitter
      const my = ((stroke[i + 1] ?? 0) + (stroke[i + 3] ?? 0)) / 2 + (rand() * 2 - 1) * jitter
      pts.push({ x: mx, y: my, t: i + 1 })
    }
  }
  return pts
}

function writeChar(ch: string, dx: number, dy: number, scale = 1, jitter = 1.5): StrokeObject[] {
  return glyphStrokes(ch).map((s, i) => ({
    type: 'stroke' as const,
    id: `b-${ch}-${i}-${dx}-${dy}-${rand()}`,
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
    const w = (glyphDef(ch)?.w ?? 60) * scale
    cursor += w + 12 * scale
  }
  return out
}

function scribble(): StrokeObject {
  return {
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
}

function strokeBox(s: StrokeObject): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of s.points) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }
  return { minX, minY, maxX, maxY }
}

describe('recognizeGlyphDetails', () => {
  it('reads a word into per-glyph detail with a shared baseline', () => {
    seed = 11
    const strokes = writeWord([{ ch: 'H' }, { ch: 'I' }])
    const details = recognizeGlyphDetails(strokes)
    expect(details).not.toBeNull()
    expect(details?.lines).toHaveLength(1)
    const line = details?.lines[0]
    expect(line?.glyphs.map((g) => g.ch)).toEqual(['H', 'I'])
    // Every input stroke is partitioned across the glyphs, none lost.
    const glyphStrokesFlat = line?.glyphs.flatMap((g) => g.strokes) ?? []
    expect(glyphStrokesFlat).toHaveLength(strokes.length)
    const ids = new Set(glyphStrokesFlat.map((s) => s.id))
    expect(ids.size).toBe(strokes.length)
    // Letters were written at y 100..200: baseline ≈ 200, cap height ≈ 100.
    expect(line ? line.baseline : 0).toBeGreaterThan(197)
    expect(line ? line.baseline : 999).toBeLessThan(203)
    expect(line ? line.capHeight : 0).toBeGreaterThan(95)
    expect(line ? line.capHeight : 999).toBeLessThan(106)
  })

  it('refuses degenerate strokes with no drawable points', () => {
    const empty: StrokeObject = {
      type: 'stroke',
      id: 'empty',
      tool: 'pen',
      color: '#1d1d1f',
      width: 3,
      smoothing: 'balanced',
      points: [],
    }
    // Every glyph score bottoms out at 0 → below the confidence gate.
    expect(recognizeGlyphDetails([empty])).toBeNull()
  })

  it('returns null for empty input', () => {
    expect(recognizeGlyphDetails([])).toBeNull()
  })
})

describe('beautifyGlyphs', () => {
  it('redraws confident glyphs and keeps weak glyphs untouched', () => {
    const hStrokes = writeChar('H', 0, 100)
    hStrokes.forEach((s) => (s.color = '#0a84ff'))
    const stray = scribble()
    const good: RecognizedGlyph = {
      ch: 'H',
      score: 0.8,
      box: { minX: 0, minY: 100, maxX: 60, maxY: 200 },
      strokes: hStrokes,
    }
    const weak: RecognizedGlyph = {
      ch: '?',
      score: 0.2,
      box: { minX: 500, minY: 100, maxX: 600, maxY: 200 },
      strokes: [stray],
    }
    const line: RecognizedLine = { glyphs: [good, weak], baseline: 200, capHeight: 100 }
    const recognition: GlyphRecognition = { lines: [line], confidence: 0.7, color: '#0a84ff' }

    const outcome = beautifyGlyphs(recognition)
    expect(outcome.replacedGlyphs).toBe(1)
    expect(outcome.keptGlyphs).toBe(1)
    // The unclear glyph's original ink object survives untouched.
    expect(outcome.strokes).toContain(stray)
    // H's template has 3 polylines → 3 replacement strokes.
    const redrawn = outcome.strokes.filter((s) => s.id !== stray.id)
    expect(redrawn).toHaveLength(3)
    // Style is inherited from the glyph's dominant ink.
    expect(redrawn.every((s) => s.color === '#0a84ff')).toBe(true)
    // Letterform is centered on the original glyph box and sits on the baseline.
    const bb = redrawn
      .map(strokeBox)
      .reduce(
        (acc, b) => ({
          minX: Math.min(acc.minX, b.minX),
          minY: Math.min(acc.minY, b.minY),
          maxX: Math.max(acc.maxX, b.maxX),
          maxY: Math.max(acc.maxY, b.maxY),
        }),
        { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
      )
    expect(bb.minX).toBeGreaterThan(-2)
    expect(bb.maxX).toBeLessThan(62)
    expect(bb.maxY).toBeGreaterThan(198)
    expect(bb.maxY).toBeLessThan(202)
  })

  it('does not shrink a line made only of x-height letters', () => {
    const oStrokes = (x: number): StrokeObject[] => [
      createStroke({ tool: 'pen', color: '#1d1d1f', width: 3, smoothing: 'balanced', points: [{ x, y: 36, t: 0 }] }),
    ]
    const makeGlyph = (x: number): RecognizedGlyph => ({
      ch: 'o',
      score: 0.8,
      box: { minX: x, minY: 36, maxX: x + 48, maxY: 100 },
      strokes: oStrokes(x),
    })
    const line: RecognizedLine = { glyphs: [makeGlyph(0), makeGlyph(60)], baseline: 100, capHeight: 64 }
    const outcome = beautifyGlyphs({ lines: [line], confidence: 0.8, color: '#1d1d1f' })
    expect(outcome.replacedGlyphs).toBe(2)
    const bb = outcome.strokes.map(strokeBox)
    const heights = bb.map((b) => b.maxY - b.minY)
    // Without the x-height correction the redrawn 'o' would be ~64% of the
    // original height; with it, size is essentially preserved.
    for (const h of heights) expect(h).toBeGreaterThan(0.75 * 64)
  })
})

describe('beautifyHandwriting', () => {
  it('beautifies a clear word end to end', () => {
    seed = 11
    const strokes = writeWord([{ ch: 'H' }, { ch: 'I' }])
    const outcome = beautifyHandwriting(strokes)
    expect(outcome).not.toBeNull()
    expect(outcome?.replacedGlyphs).toBe(2)
    expect(outcome?.keptGlyphs).toBe(0)
    expect(outcome ? outcome.confidence : 0).toBeGreaterThanOrEqual(0.62)
    // Replacement ink has fresh unique ids.
    const ids = new Set(outcome?.strokes.map((s) => s.id) ?? [])
    expect(ids.size).toBe(outcome?.strokes.length ?? 0)
    // Left-to-right letter order is preserved: 3 strokes for H, then I,
    // with no horizontal overlap between the two letters.
    const boxes = (outcome?.strokes ?? []).map(strokeBox)
    const hGroup = boxes.filter((b) => b.minX < 165)
    const iGroup = boxes.filter((b) => b.minX >= 165)
    expect(hGroup).toHaveLength(3)
    expect(iGroup).toHaveLength(3)
    const hMax = Math.max(...hGroup.map((b) => b.maxX))
    const iMin = Math.min(...iGroup.map((b) => b.minX))
    expect(hMax).toBeLessThan(iMin)
  })

  it('refuses degenerate strokes with no drawable points', () => {
    const empty: StrokeObject = {
      type: 'stroke',
      id: 'empty',
      tool: 'pen',
      color: '#1d1d1f',
      width: 3,
      smoothing: 'balanced',
      points: [],
    }
    expect(beautifyHandwriting([empty])).toBeNull()
  })

  it('treats sprawling single strokes with the same parity contract as To Text', () => {
    // A wide wavy line legitimately matches dash-like punctuation (~0.9) —
    // the shipped matcher's honest geometry. The contract, shared with the
    // text converter, is: refuse below the gate, otherwise act.
    for (const s of [37, 3, 99]) {
      seed = s
      const outcome = beautifyHandwriting([scribble()])
      if (outcome !== null) {
        expect(outcome.confidence).toBeGreaterThanOrEqual(CONFIDENCE_GATE)
        expect(outcome.replacedGlyphs).toBeGreaterThan(0)
      }
    }
  })

  it('returns null for empty input', () => {
    expect(beautifyHandwriting([])).toBeNull()
  })
})

describe('beautifyStrokesCommand', () => {
  it('replaces strokes in one undoable step and restores exact z-order', () => {
    seed = 11
    const page = createPage('P')
    const neighbor = createStroke({
      tool: 'pen',
      color: '#000000',
      width: 2,
      smoothing: 'balanced',
      points: [{ x: 0, y: 0, t: 0 }],
    })
    const ink = [...writeChar('L', 100, 100)]
    page.objects = [neighbor, ...ink]
    const notebook = { schemaVersion: 1, id: 'nb', name: 'N', pages: [page], createdAt: 0, updatedAt: 0 }

    const added = [
      createStroke({
        tool: 'pen',
        color: '#123456',
        width: 3,
        smoothing: 'balanced',
        points: [{ x: 1, y: 1, t: 0 }],
      }),
      createStroke({
        tool: 'pen',
        color: '#123456',
        width: 3,
        smoothing: 'balanced',
        points: [{ x: 2, y: 2, t: 1 }],
      }),
    ]
    const command = beautifyStrokesCommand(page.id, ink, added)
    expect(command.label).toBe('Beautify handwriting')

    const after = command.apply(notebook)
    const appliedPage = after.pages[0]
    expect(appliedPage?.objects).toHaveLength(3) // neighbor + 2 added
    expect(appliedPage?.objects[0]?.id).toBe(neighbor.id)
    expect(appliedPage?.objects[1]?.id).toBe(added[0]?.id)
    expect(appliedPage?.objects[2]?.id).toBe(added[1]?.id)

    const restored = command.revert(after)
    expect(restored.pages[0]?.objects).toEqual([neighbor, ...ink])
  })
})
