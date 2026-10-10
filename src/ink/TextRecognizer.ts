/**
 * Offline handwriting-to-text recognition (brief §11 "Text and math", done
 * deterministically — no AI model, no network, no keys).
 *
 * Pipeline:
 *   1. Cluster strokes into text lines (vertical band overlap).
 *   2. Within a line, merge strokes into glyph clusters (horizontal gap
 *      threshold derived from letter size) so multi-stroke letters stay
 *      together.
 *   3. Match each glyph against the single-stroke template set with an
 *      order-independent point-cloud distance ($P-style), then break
 *      case ties with a height-band prior (o vs O, c vs C, …).
 *   4. Assemble words: wide glyph gaps become spaces; line order becomes
 *      newlines. Font size comes from the median glyph height and the color
 *      from the dominant ink of the converted strokes.
 *
 * Honesty rules (brief §2.10, §7): the result carries a confidence; the
 * caller refuses to destroy ink when overall confidence is low, and weakly
 * recognized characters come through as '?' rather than a wrong guess.
 */

import type { Point, StrokeObject } from '../documents/DocumentModel'
import { buildCloud, buildTemplates, normalizeCloud, type GlyphBand, type Pt } from './textTemplates'

export interface TextRecognitionResult {
  text: string
  /** Top-left of the text block in document space. */
  x: number
  y: number
  fontSize: number
  color: string
  /** Mean per-glyph match score in [0, 1]. */
  confidence: number
  glyphCount: number
}

/** Overall confidence gate: below this the conversion is refused outright. */
export const CONFIDENCE_GATE = 0.62
/** Per-glyph floor: a glyph scoring under this becomes '?'. */
export const PER_CHAR_FLOOR = 0.5

const CLOUD_N = 32
const MATCH_SCALE = 0.5

interface Box {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

function strokeBox(stroke: StrokeObject): Box {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of stroke.points) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 }
  return { minX, minY, maxX, maxY }
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const a = sorted[mid - 1]
  const b = sorted[mid]
  return sorted.length % 2 === 1 ? (b ?? 0) : ((a ?? 0) + (b ?? 0)) / 2
}

// ---------------------------------------------------------------------------
// Cloud matching
// ---------------------------------------------------------------------------

function cloudDistance(a: readonly Pt[], b: readonly Pt[], start: number): number {
  const n = a.length
  let sum = 0
  let i = start
  for (let j = 0; j < n; j++) {
    const pa = a[((i % n) + n) % n]
    const pb = b[j]
    if (pa && pb) sum += Math.hypot(pa.x - pb.x, pa.y - pb.y)
    i++
  }
  return sum / n
}

/** Mean nearest-neighbour distance from every point of `a` to cloud `b`. */
function chamfer(a: readonly Pt[], b: readonly Pt[]): number {
  if (a.length === 0 || b.length === 0) return MATCH_SCALE
  let sum = 0
  for (const pa of a) {
    let best = Infinity
    for (const pb of b) {
      const d = Math.abs(pa.x - pb.x) + Math.abs(pa.y - pb.y)
      if (d < best) best = d
    }
    sum += best
  }
  // Rough √2 correction for using Manhattan distance in the inner loop.
  return sum / a.length / 1.35
}

/**
 * Order-independent match score in [0, 1]; 1 = identical clouds.
 * Combines the $P greedy index match with a symmetric chamfer distance so
 * the score survives arbitrary stroke ordering (the recognizer sorts strokes
 * by position, templates are in authored order).
 */
export function cloudMatchScore(user: readonly Pt[], template: readonly Pt[]): number {
  const n = Math.min(user.length, template.length)
  if (n === 0) return 0
  const step = Math.max(1, Math.floor(Math.sqrt(n)))
  let min = Infinity
  for (let i = 0; i < n; i += step) {
    min = Math.min(min, cloudDistance(user, template, i), cloudDistance(template, user, i))
  }
  const greedy = Math.max(0, 1 - min / MATCH_SCALE)
  const chamferScore = Math.max(0, 1 - (chamfer(user, template) + chamfer(template, user)) / (2 * MATCH_SCALE))
  return Math.max(greedy, chamferScore)
}

/** Normalize a set of strokes into one normalized point cloud. */
function strokesToCloud(strokes: readonly { points: Point[] }[]): Pt[] {
  const polys = strokes.map((s) => s.points.map((p) => ({ x: p.x, y: p.y })))
  return normalizeCloud(buildCloud(polys, CLOUD_N))
}

// ---------------------------------------------------------------------------
// Line clustering and glyph segmentation
// ---------------------------------------------------------------------------

interface StrokeInfo {
  stroke: StrokeObject
  box: Box
}

interface LineCluster {
  items: StrokeInfo[]
  minY: number
  maxY: number
}

/**
 * Cluster strokes into writing lines.
 *
 * Two waves: tall "body" strokes (stems, diagonals, bowls) seed the line
 * clusters first, then thin strokes (crossbars at the top/bottom edge of a
 * letter, i-dots, accents) attach to the cluster they overlap or sit nearest
 * to. Clustering thin bars in the same wave as bodies lets a bar that sits a
 * hair above the letter body spawn its own phantom line.
 */
export function clusterLines(strokes: readonly StrokeInfo[]): LineCluster[] {
  if (strokes.length === 0) return []
  const centerOf = (b: Box): number => (b.minY + b.maxY) / 2
  const maxH = Math.max(...strokes.map((s) => s.box.maxY - s.box.minY), 1)
  const tallThreshold = 0.45 * maxH
  const tall = strokes.filter((s) => s.box.maxY - s.box.minY >= tallThreshold)
  const thin = strokes.filter((s) => s.box.maxY - s.box.minY < tallThreshold)

  const clusters: LineCluster[] = []
  const addTo = (cluster: LineCluster, item: StrokeInfo): void => {
    cluster.items.push(item)
    cluster.minY = Math.min(cluster.minY, item.box.minY)
    cluster.maxY = Math.max(cluster.maxY, item.box.maxY)
  }
  const overlaps = (item: StrokeInfo, cluster: LineCluster): number =>
    Math.min(item.box.maxY, cluster.maxY) - Math.max(item.box.minY, cluster.minY)

  // Wave 1: body strokes seed the lines.
  const sortedTall = [...tall].sort((a, b) => centerOf(a.box) - centerOf(b.box))
  for (const item of sortedTall) {
    const itemH = item.box.maxY - item.box.minY
    const centerY = centerOf(item.box)
    let best: LineCluster | null = null
    let bestOverlap = -Infinity
    for (const cluster of clusters) {
      const clusterH = cluster.maxY - cluster.minY
      const overlap = overlaps(item, cluster)
      const widen = 0.5 * Math.max(itemH, clusterH)
      const centerInside = centerY >= cluster.minY - widen && centerY <= cluster.maxY + widen
      const qualifies = overlap > 0.35 * Math.min(itemH, Math.max(clusterH, 1)) || (centerInside && overlap >= 0)
      if (qualifies && overlap > bestOverlap) {
        best = cluster
        bestOverlap = overlap
      }
    }
    if (best) addTo(best, item)
    else clusters.push({ items: [item], minY: item.box.minY, maxY: item.box.maxY })
  }

  // Wave 2: thin strokes attach to the line they overlap or sit nearest to.
  const sortedThin = [...thin].sort((a, b) => centerOf(a.box) - centerOf(b.box))
  for (const item of sortedThin) {
    const centerY = centerOf(item.box)
    let best: LineCluster | null = null
    let bestOverlap = -Infinity
    for (const cluster of clusters) {
      const overlap = overlaps(item, cluster)
      if (overlap > 0 && overlap > bestOverlap) {
        best = cluster
        bestOverlap = overlap
      }
    }
    if (!best && clusters.length > 0) {
      // No direct overlap: attach to the nearest line when within half the
      // tallest stroke's height of its band (keeps i-dots and T bars with
      // their letters; a stray mark far below stays its own line).
      const limit = 0.5 * maxH
      let bestDist = Infinity
      for (const cluster of clusters) {
        const dist = cluster.minY - centerY > 0 ? cluster.minY - centerY : centerY - cluster.maxY > 0 ? centerY - cluster.maxY : 0
        if (dist <= limit && dist < bestDist) {
          best = cluster
          bestDist = dist
        }
      }
    }
    if (best) addTo(best, item)
    else clusters.push({ items: [item], minY: item.box.minY, maxY: item.box.maxY })
  }

  return clusters.sort((a, b) => a.minY - b.minY)
}

interface GlyphCluster {
  strokes: StrokeInfo[]
  box: Box
  /** Stroke boxes widened by half the ink width, used for merge decisions. */
  padBox: Box
}

/** Merge horizontally-adjacent strokes of one line into glyph clusters. */
export function segmentGlyphs(line: LineCluster): GlyphCluster[] {
  const items = [...line.items].sort((a, b) => a.box.minX - b.box.minX)
  const heights = items.map((s) => s.box.maxY - s.box.minY)
  const medianH = Math.max(1, median(heights))
  // Ink boxes, not centerline boxes: the drawn stroke is `width` units thick,
  // so a crossbar whose centerline stops 1–2 units short of a stem still
  // touches it visibly. Without this, letters split apart after smoothing.
  const pad = (s: StrokeInfo): Box => {
    const p = s.stroke.width / 2 + 1.5
    return { minX: s.box.minX - p, minY: s.box.minY - p, maxX: s.box.maxX + p, maxY: s.box.maxY + p }
  }
  const glyphs: GlyphCluster[] = []
  for (const item of items) {
    const box = pad(item)
    const last = glyphs[glyphs.length - 1]
    if (last) {
      const lastBox = last.padBox
      const overlap = Math.min(box.maxX, lastBox.maxX) - Math.max(box.minX, lastBox.minX)
      const gap = box.minX - lastBox.maxX
      const itemH = item.box.maxY - item.box.minY
      // Merge when strokes physically overlap (multi-stroke letters like A,
      // H, E) or when a small accent (i/j dot, apostrophe) sits right on the
      // letter. Letter gaps inside a word stay separate — conflating two
      // letters is worse than splitting one.
      const isAccent = itemH < 0.4 * medianH
      if (overlap > 0 || (isAccent && gap < 0.08 * medianH)) {
        last.strokes.push(item)
        last.padBox = {
          minX: Math.min(lastBox.minX, box.minX),
          minY: Math.min(lastBox.minY, box.minY),
          maxX: Math.max(lastBox.maxX, box.maxX),
          maxY: Math.max(lastBox.maxY, box.maxY),
        }
        last.box.minX = Math.min(last.box.minX, item.box.minX)
        last.box.minY = Math.min(last.box.minY, item.box.minY)
        last.box.maxX = Math.max(last.box.maxX, item.box.maxX)
        last.box.maxY = Math.max(last.box.maxY, item.box.maxY)
        continue
      }
    }
    glyphs.push({ strokes: [item], box: { ...item.box }, padBox: box })
  }
  return glyphs
}

// ---------------------------------------------------------------------------
// Recognition
// ---------------------------------------------------------------------------

interface ScoredGlyph {
  ch: string
  score: number
  box: Box
}

function bandPenalty(ratio: number, band: GlyphBand): number {
  // ratio = glyph height / line cap height.
  if (band === 'asc' && ratio < 0.78) return 0.07
  if (band === 'x' && ratio > 0.9) return 0.07
  return 0
}

function matchGlyph(
  glyph: GlyphCluster,
  capHeight: number,
  templates: readonly { ch: string; band: GlyphBand; cloud: readonly Pt[] }[],
): ScoredGlyph {
  const cloud = strokesToCloud(glyph.strokes.map((s) => s.stroke))
  const h = glyph.box.maxY - glyph.box.minY
  const ratio = capHeight > 0 ? h / capHeight : 1
  let bestCh = '?'
  let bestScore = -Infinity
  for (const t of templates) {
    const base = cloudMatchScore(cloud, t.cloud)
    const score = base - bandPenalty(ratio, t.band)
    if (score > bestScore) {
      bestScore = score
      bestCh = t.ch
    }
  }
  if (bestScore < PER_CHAR_FLOOR) return { ch: '?', score: bestScore, box: glyph.box }
  return { ch: bestCh, score: bestScore, box: glyph.box }
}

function dominantColor(strokes: readonly StrokeInfo[]): string {
  const counts = new Map<string, number>()
  for (const s of strokes) counts.set(s.stroke.color, (counts.get(s.stroke.color) ?? 0) + 1)
  let best = ''
  let bestN = -1
  for (const [color, n] of counts) {
    if (n > bestN) {
      best = color
      bestN = n
    }
  }
  return best || '#1d1d1f'
}

/**
 * Recognize handwriting strokes as a text block. Returns null when the input
 * is empty or overall confidence is below the gate — the caller must keep
 * the ink untouched in that case.
 */
export function recognizeText(strokes: readonly StrokeObject[]): TextRecognitionResult | null {
  if (strokes.length === 0) return null
  const templates = buildTemplates()
  const infos: StrokeInfo[] = strokes.map((stroke) => ({ stroke, box: strokeBox(stroke) }))
  const lines = clusterLines(infos)

  interface AssembledLine {
    glyphs: ScoredGlyph[]
    scores: number[]
  }
  const assembled: AssembledLine[] = []
  for (const line of lines) {
    const glyphs = segmentGlyphs(line)
    if (glyphs.length === 0) continue
    const capHeight = Math.max(...glyphs.map((g) => g.box.maxY - g.box.minY), 1)
    const scored = glyphs.map((g) => matchGlyph(g, capHeight, templates))
    assembled.push({ glyphs: scored, scores: scored.map((s) => s.score) })
  }
  if (assembled.length === 0) return null

  const allGlyphs = assembled.flatMap((l) => l.glyphs)
  const confidence = allGlyphs.reduce((acc, g) => acc + g.score, 0) / allGlyphs.length
  if (confidence < CONFIDENCE_GATE) return null

  // Word spacing within each line; newlines between lines. A word gap must
  // exceed both a fraction of the median letter advance and a fraction of
  // the letter height, so narrow letters (l, i, 1) do not read as spaces.
  const linesText = assembled.map((line) => {
    const advances: number[] = []
    for (let i = 1; i < line.glyphs.length; i++) {
      const a = line.glyphs[i - 1]
      const b = line.glyphs[i]
      if (a && b) advances.push(b.box.minX - a.box.minX)
    }
    const medianAdvance = advances.length > 0 ? Math.max(10, median(advances)) : 0
    const medianHeight = Math.max(1, median(line.glyphs.map((g) => g.box.maxY - g.box.minY)))
    const spaceGap = Math.max(0.35 * medianAdvance, 0.3 * medianHeight)
    let text = ''
    let prev: ScoredGlyph | null = null
    for (const glyph of line.glyphs) {
      if (prev && medianAdvance > 0) {
        const gap = glyph.box.minX - prev.box.maxX
        if (gap > spaceGap) text += ' '
      }
      text += glyph.ch
      prev = glyph
    }
    return text
  })
  const text = linesText.join('\n')

  const heights = allGlyphs.map((g) => g.box.maxY - g.box.minY)
  const fontSize = Math.min(500, Math.max(10, Math.round(median(heights) * 1.18)))
  const x = Math.min(...allGlyphs.map((g) => g.box.minX)) - fontSize * 0.08
  const y = Math.min(...allGlyphs.map((g) => g.box.minY)) - fontSize * 0.2

  return {
    text,
    x,
    y,
    fontSize,
    color: dominantColor(infos),
    confidence,
    glyphCount: allGlyphs.length,
  }
}
