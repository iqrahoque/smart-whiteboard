/**
 * Handwriting beautification — the "iPad neat ink" action.
 *
 * Recognized letters are REDRAWN as clean letterforms: each matched character
 * is rendered from the same Hershey-style template polylines the recognizer
 * matches against, resampled to fine point spacing, lightly rounded so the
 * result reads as neat hand-lettering (not typed text), scaled to the line's
 * cap height and aligned to one straight baseline per writing line. The
 * original horizontal layout (letter positions, word gaps, line breaks) is
 * preserved.
 *
 * Honesty rules, mirroring the text converter:
 *   - glyphs below the per-character floor keep their original ink untouched
 *   - if nothing is recognized confidently, the whole action refuses (null)
 *   - everything lands as one undoable command in the caller
 *
 * No AI model, no network: pure deterministic geometry.
 */

import type { InkTool, SampledPoint, StrokeObject } from '../documents/DocumentModel'
import { createStroke } from '../documents/DocumentModel'
import { glyphDef, resamplePolyline, type Pt } from './textTemplates'
import { PER_CHAR_FLOOR, recognizeGlyphDetails } from './TextRecognizer'
import type { GlyphRecognition, RecognizedGlyph, RecognizedLine } from './TextRecognizer'

export interface BeautifyOutcome {
  /** Replacement ink: redrawn letterforms plus untouched low-confidence originals. */
  strokes: StrokeObject[]
  /** Glyphs redrawn from template letterforms. */
  replacedGlyphs: number
  /** Glyphs whose original ink was kept (below the per-character floor). */
  keptGlyphs: number
  /** Overall recognition confidence of the input (same measure as To Text). */
  confidence: number
}

/** Template em box: y = 0 cap top, y = 100 baseline, y > 100 descenders. */
const TEMPLATE_BASELINE = 100
/**
 * Template x-height as a fraction of cap height. When a line contains no
 * full-height glyph, cap height is estimated from its lowercase letters via
 * this ratio so an all-lowercase line is not shrunk to 65% of its size.
 */
const TEMPLATE_X_RATIO = 0.65
/** Target spacing (document units) between redrawn points. */
const POINT_SPACING = 2.5
/** Light corner-rounding pass so letterforms look hand-drawn, not CAD. */
const ROUND_ALPHA = 0.5

function median(values: readonly number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const a = sorted[mid - 1]
  const b = sorted[mid]
  return sorted.length % 2 === 1 ? (b ?? 0) : ((a ?? 0) + (b ?? 0)) / 2
}

function majorityKey<T extends string>(values: readonly T[], fallback: T): T {
  const counts = new Map<T, number>()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
  let best = fallback
  let bestN = 0
  for (const [v, n] of counts) {
    if (n > bestN) {
      best = v
      bestN = n
    }
  }
  return best
}

function dominantColor(strokes: readonly StrokeObject[]): string {
  return majorityKey(strokes.map((s) => s.color), '#1d1d1f')
}

function dominantTool(strokes: readonly StrokeObject[]): InkTool {
  return majorityKey(strokes.map((s) => s.tool), 'pen')
}

/**
 * One light exponential pass over resampled template points. Template corners
 * (e.g. the vertex of an L) arrive as sharp angle points; a single alpha pass
 * rounds them just enough to read as pen-drawn while keeping exact endpoints.
 */
function roundCorners(points: readonly SampledPoint[], alpha: number): SampledPoint[] {
  if (points.length < 3) return points.map((p) => ({ ...p }))
  const first = points[0]
  const last = points[points.length - 1]
  if (!first || !last) return points.map((p) => ({ ...p }))
  const out: SampledPoint[] = [{ ...first }]
  for (let i = 1; i < points.length - 1; i++) {
    const cur = points[i]
    const prev = out[i - 1]
    if (!cur || !prev) continue
    out.push({
      x: prev.x + (cur.x - prev.x) * alpha,
      y: prev.y + (cur.y - prev.y) * alpha,
      t: cur.t,
    })
  }
  out.push({ ...last })
  return out
}

function flatToPts(flat: readonly number[]): Pt[] {
  const pts: Pt[] = []
  for (let i = 0; i + 1 < flat.length; i += 2) pts.push({ x: flat[i] ?? 0, y: flat[i + 1] ?? 0 })
  return pts
}

/** Horizontal center of a template glyph's own ink (for center placement). */
function templateCenterX(polylines: readonly (readonly Pt[])[]): number {
  let minX = Infinity
  let maxX = -Infinity
  for (const poly of polylines) {
    for (const p of poly) {
      if (p.x < minX) minX = p.x
      if (p.x > maxX) maxX = p.x
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(maxX)) return 0
  return (minX + maxX) / 2
}

/**
 * Uniform template→document scale for one line: cap height maps to 100
 * template units. A line whose tallest glyphs are all x-height letters has no
 * ascender to measure from, so cap height is inflated by the template ratio.
 */
function lineScale(line: RecognizedLine): number {
  const tallest = line.glyphs.filter((g) => g.box.maxY - g.box.minY >= 0.9 * line.capHeight)
  const allXHeight = tallest.length > 0 && tallest.every((g) => glyphDef(g.ch)?.band === 'x')
  const cap = allXHeight ? line.capHeight / TEMPLATE_X_RATIO : line.capHeight
  return cap / TEMPLATE_BASELINE
}

/**
 * Redraw one recognized glyph as template letterform strokes, or null when
 * the character has no template (caller keeps the original ink).
 */
function redrawGlyph(glyph: RecognizedGlyph, line: RecognizedLine): StrokeObject[] | null {
  const def = glyphDef(glyph.ch)
  if (!def) return null
  const scale = lineScale(line)
  const polylines = def.strokes.map(flatToPts)
  const centerX = templateCenterX(polylines)
  const glyphCenterX = (glyph.box.minX + glyph.box.maxX) / 2
  const color = dominantColor(glyph.strokes)
  const width = median(glyph.strokes.map((s) => s.width))
  const tool = dominantTool(glyph.strokes)

  const out: StrokeObject[] = []
  let t = 0
  for (const poly of polylines) {
    let len = 0
    for (let i = 1; i < poly.length; i++) {
      const a = poly[i - 1]
      const b = poly[i]
      if (a && b) len += Math.hypot(b.x - a.x, b.y - a.y)
    }
    const n = Math.max(4, Math.min(240, Math.round((len * scale) / POINT_SPACING) + 1))
    const resampled = resamplePolyline(poly, n)
    const points: SampledPoint[] = []
    for (const p of resampled) {
      t += 1
      points.push({
        x: glyphCenterX + (p.x - centerX) * scale,
        y: line.baseline + (p.y - TEMPLATE_BASELINE) * scale,
        t,
      })
    }
    const rounded = roundCorners(points, ROUND_ALPHA)
    if (rounded.length > 0) {
      out.push(createStroke({ tool, color, width, smoothing: 'balanced', points: rounded }))
    }
  }
  return out.length > 0 ? out : null
}

/**
 * Build the replacement ink set from a per-glyph recognition. Confident
 * glyphs become redrawn letterforms; weak glyphs ('?' or below the
 * per-character floor) keep their original strokes so no ink is destroyed on
 * a guess.
 */
export function beautifyGlyphs(recognition: GlyphRecognition): BeautifyOutcome {
  const out: StrokeObject[] = []
  let replaced = 0
  let kept = 0
  for (const line of recognition.lines) {
    for (const glyph of line.glyphs) {
      const weak = glyph.ch === '?' || glyph.score < PER_CHAR_FLOOR
      const redrawn = weak ? null : redrawGlyph(glyph, line)
      if (redrawn) {
        out.push(...redrawn)
        replaced++
      } else {
        out.push(...glyph.strokes)
        kept++
      }
    }
  }
  return { strokes: out, replacedGlyphs: replaced, keptGlyphs: kept, confidence: recognition.confidence }
}

/**
 * Beautify handwriting strokes: recognize per glyph, then redraw. Returns
 * null when the input is empty, below the overall confidence gate, or when
 * nothing was recognized confidently enough to redraw a single glyph — the
 * caller must keep the ink untouched in every null case.
 */
export function beautifyHandwriting(strokes: readonly StrokeObject[]): BeautifyOutcome | null {
  const recognition = recognizeGlyphDetails(strokes)
  if (!recognition) return null
  const outcome = beautifyGlyphs(recognition)
  if (outcome.replacedGlyphs === 0) return null
  return outcome
}
