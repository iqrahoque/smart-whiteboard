/**
 * Glyph templates for offline handwriting-to-text recognition.
 *
 * A compact single-stroke (Hershey-style) letter set: every character is
 * authored as 1–4 polylines in an em box where y = 0 is the cap top, y = 100
 * is the baseline and descenders reach y = 130. Widths are per-glyph so that
 * spacing analysis can use realistic proportions.
 *
 * These polylines are converted to normalized point clouds (`buildTemplates`)
 * and matched against handwriting with an order-independent cloud distance —
 * the same technique as the $P recognizer. No AI model, no network: pure
 * deterministic geometry.
 *
 * Bands describe the expected vertical extent of the glyph, used to break
 * case ties (o vs O, c vs C) from the glyph's size relative to the line:
 *   'asc'  — spans (roughly) the full cap height (uppercase, digits, b d f…)
 *   'x'    — x-height letter (a c e m n o …)
 *   'desc' — descends below the baseline (g j p q y)
 *   'any'  — punctuation with no reliable height expectation
 */

export type GlyphBand = 'asc' | 'x' | 'desc' | 'any'

export interface GlyphDef {
  ch: string
  /** Advance width in the same units as the coordinates below. */
  w: number
  band: GlyphBand
  /** Polylines as flat [x, y, x, y, …] arrays. */
  strokes: number[][]
}

const U = 'asc'
const X = 'x'
const D = 'desc'
const A = 'any'

function ellipse(cx: number, cy: number, rx: number, ry: number, steps = 12): number[] {
  const out: number[] = []
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2
    out.push(cx + rx * Math.cos(a), cy + ry * Math.sin(a))
  }
  return out
}

export const GLYPHS: readonly GlyphDef[] = [
  // --- Uppercase -----------------------------------------------------------
  { ch: 'A', w: 60, band: U, strokes: [[0, 100, 30, 0, 60, 100], [15, 65, 45, 65]] },
  { ch: 'B', w: 62, band: U, strokes: [[0, 0, 0, 100], [0, 0, 45, 0, 60, 12, 60, 38, 45, 50, 0, 50], [45, 50, 62, 62, 62, 88, 45, 100, 0, 100]] },
  { ch: 'C', w: 60, band: U, strokes: [[60, 15, 45, 0, 20, 0, 0, 20, 0, 80, 20, 100, 45, 100, 60, 85]] },
  { ch: 'D', w: 62, band: U, strokes: [[0, 0, 0, 100], [0, 0, 40, 0, 62, 20, 62, 80, 40, 100, 0, 100]] },
  { ch: 'E', w: 60, band: U, strokes: [[60, 0, 0, 0, 0, 100, 60, 100], [0, 50, 45, 50]] },
  { ch: 'F', w: 60, band: U, strokes: [[60, 0, 0, 0, 0, 100], [0, 50, 45, 50]] },
  { ch: 'G', w: 60, band: U, strokes: [[60, 15, 45, 0, 20, 0, 0, 20, 0, 80, 20, 100, 45, 100, 60, 85, 60, 55, 30, 55]] },
  { ch: 'H', w: 60, band: U, strokes: [[0, 0, 0, 100], [60, 0, 60, 100], [0, 50, 60, 50]] },
  { ch: 'I', w: 60, band: U, strokes: [[10, 0, 50, 0], [30, 0, 30, 100], [10, 100, 50, 100]] },
  { ch: 'J', w: 50, band: U, strokes: [[50, 0, 50, 80, 35, 100, 15, 100, 0, 85]] },
  { ch: 'K', w: 60, band: U, strokes: [[0, 0, 0, 100], [60, 0, 0, 55], [20, 38, 60, 100]] },
  { ch: 'L', w: 60, band: U, strokes: [[0, 0, 0, 100, 60, 100]] },
  { ch: 'M', w: 70, band: U, strokes: [[0, 100, 0, 0, 35, 55, 70, 0, 70, 100]] },
  { ch: 'N', w: 60, band: U, strokes: [[0, 100, 0, 0, 60, 100, 60, 0]] },
  { ch: 'O', w: 60, band: U, strokes: [ellipse(30, 50, 30, 50)] },
  { ch: 'P', w: 60, band: U, strokes: [[0, 0, 0, 100], [0, 0, 45, 0, 60, 12, 60, 38, 45, 50, 0, 50]] },
  { ch: 'Q', w: 64, band: U, strokes: [ellipse(30, 50, 30, 50), [42, 72, 62, 100]] },
  { ch: 'R', w: 60, band: U, strokes: [[0, 0, 0, 100], [0, 0, 45, 0, 60, 12, 60, 38, 45, 50, 0, 50], [25, 50, 60, 100]] },
  { ch: 'S', w: 60, band: U, strokes: [[58, 15, 45, 0, 18, 0, 3, 12, 3, 32, 18, 45, 45, 55, 58, 68, 58, 88, 42, 100, 15, 100, 2, 88]] },
  { ch: 'T', w: 60, band: U, strokes: [[0, 0, 60, 0], [30, 0, 30, 100]] },
  { ch: 'U', w: 60, band: U, strokes: [[0, 0, 0, 75, 10, 92, 30, 100, 50, 92, 60, 75, 60, 0]] },
  { ch: 'V', w: 60, band: U, strokes: [[0, 0, 30, 100, 60, 0]] },
  { ch: 'W', w: 70, band: U, strokes: [[0, 0, 17, 100, 35, 40, 53, 100, 70, 0]] },
  { ch: 'X', w: 60, band: U, strokes: [[0, 0, 60, 100], [60, 0, 0, 100]] },
  { ch: 'Y', w: 60, band: U, strokes: [[0, 0, 30, 45], [60, 0, 30, 45], [30, 45, 30, 100]] },
  { ch: 'Z', w: 60, band: U, strokes: [[0, 0, 60, 0, 0, 100, 60, 100]] },

  // --- Lowercase -----------------------------------------------------------
  { ch: 'a', w: 46, band: X, strokes: [ellipse(22, 68, 22, 32), [44, 35, 44, 100]] },
  { ch: 'b', w: 50, band: 'asc', strokes: [[0, 0, 0, 100], ellipse(25, 68, 25, 32)] },
  { ch: 'c', w: 44, band: X, strokes: [[40, 45, 28, 35, 10, 38, 0, 55, 0, 82, 12, 98, 30, 100, 42, 92]] },
  { ch: 'd', w: 50, band: 'asc', strokes: [ellipse(25, 68, 25, 32), [50, 0, 50, 100]] },
  { ch: 'e', w: 44, band: X, strokes: [[0, 68, 44, 68, 44, 50, 30, 35, 10, 40, 0, 58, 0, 82, 12, 98, 32, 100, 44, 92]] },
  { ch: 'f', w: 38, band: 'asc', strokes: [[40, 0, 22, 5, 12, 25, 12, 100], [0, 45, 35, 45]] },
  { ch: 'g', w: 46, band: D, strokes: [ellipse(22, 68, 22, 32), [44, 35, 44, 112, 35, 128, 18, 132, 5, 125]] },
  { ch: 'h', w: 48, band: 'asc', strokes: [[0, 0, 0, 100], [0, 55, 12, 40, 30, 35, 45, 45, 48, 65, 48, 100]] },
  { ch: 'i', w: 10, band: X, strokes: [[2, 35, 2, 100], [2, 10, 2, 15]] },
  { ch: 'j', w: 28, band: D, strokes: [[20, 35, 20, 112, 14, 127, 2, 130], [20, 10, 20, 15]] },
  { ch: 'k', w: 40, band: 'asc', strokes: [[0, 0, 0, 100], [38, 35, 0, 68], [12, 55, 40, 100]] },
  { ch: 'l', w: 10, band: 'asc', strokes: [[5, 0, 5, 100]] },
  { ch: 'm', w: 66, band: X, strokes: [[0, 35, 0, 100], [0, 48, 10, 38, 22, 35, 30, 45, 32, 65, 32, 100], [32, 48, 42, 38, 54, 35, 62, 45, 64, 65, 64, 100]] },
  { ch: 'n', w: 48, band: X, strokes: [[0, 35, 0, 100], [0, 50, 12, 39, 30, 35, 44, 46, 46, 68, 46, 100]] },
  { ch: 'o', w: 48, band: X, strokes: [ellipse(24, 68, 24, 32)] },
  { ch: 'p', w: 48, band: D, strokes: [[0, 35, 0, 130], ellipse(24, 68, 24, 32)] },
  { ch: 'q', w: 48, band: D, strokes: [ellipse(24, 68, 24, 32), [48, 35, 48, 130]] },
  { ch: 'r', w: 40, band: X, strokes: [[2, 35, 2, 100], [2, 55, 15, 40, 32, 35, 40, 38]] },
  { ch: 's', w: 40, band: X, strokes: [[38, 42, 28, 35, 10, 36, 2, 46, 6, 58, 30, 68, 38, 80, 34, 94, 16, 100, 2, 92]] },
  { ch: 't', w: 34, band: 'asc', strokes: [[10, 0, 10, 85, 18, 98, 32, 100], [0, 42, 32, 42]] },
  { ch: 'u', w: 48, band: X, strokes: [[0, 35, 0, 80, 8, 95, 25, 100, 42, 90, 46, 75, 46, 100]] },
  { ch: 'v', w: 44, band: X, strokes: [[0, 35, 22, 100, 44, 35]] },
  { ch: 'w', w: 50, band: X, strokes: [[0, 35, 12, 100, 24, 60, 36, 100, 48, 35]] },
  { ch: 'x', w: 42, band: X, strokes: [[0, 35, 42, 100], [42, 35, 0, 100]] },
  { ch: 'y', w: 46, band: D, strokes: [[0, 35, 22, 100], [44, 35, 20, 112, 6, 128]] },
  { ch: 'z', w: 42, band: X, strokes: [[0, 35, 42, 35, 0, 100, 42, 100]] },

  // --- Digits --------------------------------------------------------------
  { ch: '0', w: 60, band: U, strokes: [ellipse(30, 50, 30, 50)] },
  { ch: '1', w: 34, band: U, strokes: [[0, 20, 25, 0, 30, 5, 30, 100]] },
  { ch: '2', w: 58, band: U, strokes: [[2, 18, 15, 2, 38, 0, 52, 10, 55, 28, 40, 50, 8, 78, 0, 100, 58, 100]] },
  { ch: '3', w: 54, band: U, strokes: [[2, 10, 18, 0, 40, 2, 52, 15, 50, 35, 35, 48, 50, 62, 52, 85, 38, 100, 15, 100, 2, 88]] },
  { ch: '4', w: 58, band: U, strokes: [[40, 100, 40, 0, 0, 70, 58, 70]] },
  { ch: '5', w: 56, band: U, strokes: [[55, 0, 5, 0, 2, 42, 35, 38, 52, 50, 55, 72, 42, 95, 15, 100, 2, 90]] },
  { ch: '6', w: 56, band: U, strokes: [[52, 2, 28, 0, 8, 25, 2, 60, 8, 88, 28, 100, 48, 90, 52, 68, 40, 50, 15, 48, 2, 60]] },
  { ch: '7', w: 58, band: U, strokes: [[0, 0, 58, 0, 22, 100]] },
  { ch: '8', w: 56, band: U, strokes: [ellipse(28, 25, 25, 25), ellipse(28, 75, 28, 25)] },
  { ch: '9', w: 56, band: U, strokes: [[4, 98, 28, 100, 48, 75, 54, 40, 48, 12, 28, 0, 8, 10, 4, 32, 16, 50, 41, 52, 54, 40]] },

  // --- Punctuation ---------------------------------------------------------
  { ch: '.', w: 10, band: A, strokes: [[4, 94, 6, 100]] },
  { ch: ',', w: 10, band: A, strokes: [[8, 94, 4, 112, 0, 118]] },
  { ch: '!', w: 14, band: A, strokes: [[6, 0, 7, 70], [7, 92, 8, 97]] },
  { ch: '?', w: 50, band: A, strokes: [[2, 20, 12, 3, 30, 0, 45, 10, 48, 28, 35, 45, 28, 58, 28, 70], [28, 90, 29, 96]] },
  { ch: "'", w: 10, band: A, strokes: [[6, 0, 2, 18]] },
  { ch: '-', w: 50, band: A, strokes: [[5, 55, 45, 55]] },
  { ch: '(', w: 40, band: A, strokes: [[40, 0, 15, 30, 10, 50, 15, 70, 40, 100]] },
  { ch: ')', w: 40, band: A, strokes: [[0, 0, 25, 30, 30, 50, 25, 70, 0, 100]] },
  { ch: '/', w: 50, band: A, strokes: [[45, 0, 5, 100]] },
  { ch: '+', w: 50, band: A, strokes: [[25, 30, 25, 80], [0, 55, 50, 55]] },
  { ch: '=', w: 50, band: A, strokes: [[5, 40, 45, 40], [5, 70, 45, 70]] },
  { ch: ':', w: 12, band: A, strokes: [[6, 38, 7, 42], [6, 92, 7, 96]] },
]

// ---------------------------------------------------------------------------
// Template clouds
// ---------------------------------------------------------------------------

export interface Pt {
  x: number
  y: number
}

export interface GlyphTemplate {
  ch: string
  band: GlyphBand
  cloud: Pt[]
}

function flatToPoints(stroke: number[]): Pt[] {
  const pts: Pt[] = []
  for (let i = 0; i + 1 < stroke.length; i += 2) pts.push({ x: stroke[i] ?? 0, y: stroke[i + 1] ?? 0 })
  return pts
}

/** Resample one polyline to exactly n points by arc length. */
export function resamplePolyline(pts: readonly Pt[], n: number): Pt[] {
  if (pts.length === 0 || n <= 0) return []
  if (pts.length === 1 || n === 1) {
    const p = pts[0]
    return p ? Array.from({ length: n }, () => ({ ...p })) : []
  }
  const lens: number[] = [0]
  let total = 0
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    if (!a || !b) continue
    total += Math.hypot(b.x - a.x, b.y - a.y)
    lens.push(total)
  }
  if (total === 0) {
    const p = pts[0]
    return p ? Array.from({ length: n }, () => ({ ...p })) : []
  }
  const out: Pt[] = []
  let seg = 1
  for (let k = 0; k < n; k++) {
    const target = (total * k) / (n - 1)
    while (seg < pts.length - 1 && (lens[seg] ?? 0) < target) seg++
    const a = pts[seg - 1]
    const b = pts[seg]
    const la = lens[seg - 1] ?? 0
    const lb = lens[seg] ?? 0
    const t = lb > la ? (target - la) / (lb - la) : 0
    if (a && b) out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
  }
  return out
}

/**
 * Build an N-point cloud from several strokes: points are distributed across
 * strokes proportionally to arc length (minimum 2 each) so the cloud density
 * matches independent of stroke order or drawing speed.
 */
export function buildCloud(strokes: readonly (readonly Pt[])[], n = 32): Pt[] {
  const lengths = strokes.map((s) => s.reduce((acc, p, i) => (i > 0 && s[i - 1] ? acc + Math.hypot(p.x - (s[i - 1] as Pt).x, p.y - (s[i - 1] as Pt).y) : acc), 0))
  const total = lengths.reduce((a, b) => a + b, 0)
  const shares = lengths.map((l) => (total === 0 ? n / strokes.length : (l / total) * n))
  // Largest-remainder rounding with a floor of 2 points per stroke.
  const counts = shares.map((s) => Math.max(2, Math.floor(s)))
  let used = counts.reduce((a, b) => a + b, 0)
  const order = shares
    .map((s, i) => ({ i, frac: s - Math.floor(s) }))
    .sort((a, b) => b.frac - a.frac)
  let oi = 0
  while (used < n && order.length > 0) {
    const entry = order[oi % order.length]
    if (entry) counts[entry.i] = (counts[entry.i] ?? 2) + 1
    used++
    oi++
  }
  while (used > n) {
    let maxI = 0
    for (let i = 1; i < counts.length; i++) {
      if ((counts[i] ?? 0) > (counts[maxI] ?? 0)) maxI = i
    }
    if ((counts[maxI] ?? 0) <= 2) break
    counts[maxI] = (counts[maxI] ?? 2) - 1
    used--
  }
  const cloud: Pt[] = []
  strokes.forEach((s, i) => {
    const k = counts[i] ?? 2
    cloud.push(...resamplePolyline(s, k))
  })
  return cloud
}

/** $P-style normalization: scale uniformly by the longest side, center at origin. */
export function normalizeCloud(cloud: readonly Pt[]): Pt[] {
  if (cloud.length === 0) return []
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let cx = 0
  let cy = 0
  for (const p of cloud) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
    cx += p.x
    cy += p.y
  }
  cx /= cloud.length
  cy /= cloud.length
  const scale = 1 / Math.max(1e-6, Math.max(maxX - minX, maxY - minY))
  return cloud.map((p) => ({ x: (p.x - cx) * scale, y: (p.y - cy) * scale }))
}

let templateCache: GlyphTemplate[] | null = null

/** All glyph templates as normalized point clouds (built once, then cached). */
export function buildTemplates(): readonly GlyphTemplate[] {
  if (templateCache) return templateCache
  templateCache = GLYPHS.map((g) => ({
    ch: g.ch,
    band: g.band,
    cloud: normalizeCloud(buildCloud(g.strokes.map(flatToPoints))),
  }))
  return templateCache
}

/** Template glyph definition lookup (for tests and spacing heuristics). */
export function glyphDef(ch: string): GlyphDef | undefined {
  return GLYPHS.find((g) => g.ch === ch)
}

/** Flat polylines of a template glyph, for tests that trace characters. */
export function glyphStrokes(ch: string): number[][] {
  const def = glyphDef(ch)
  return def ? def.strokes : []
}
