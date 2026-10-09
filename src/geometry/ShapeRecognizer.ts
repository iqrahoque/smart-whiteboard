/**
 * Deterministic shape recognition (brief §7). No AI model: geometric measures
 * only, conservative thresholds, ambiguous input stays freehand.
 *
 * Pipeline: resample by arc length → simplify (RDP) → measure (straightness,
 * closure, corners, circularity) → score candidates → best above threshold.
 */

import type { SampledPoint, ShapeKind } from '../documents/DocumentModel'

export interface ShapeCandidate {
  kind: ShapeKind
  x1: number
  y1: number
  x2: number
  y2: number
  score: number
}

/** Minimum recognition score; below this the stroke stays freehand. */
export const RECOGNIZE_THRESHOLD = 0.72

const RESAMPLE_N = 64
const MIN_POINTS = 8

function sqDist(a: SampledPoint, b: SampledPoint): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return dx * dx + dy * dy
}

/** Resample a polyline into n equally-spaced points (by arc length). */
export function resampleByArcLength(points: readonly SampledPoint[], n: number): SampledPoint[] {
  if (points.length === 0) return []
  if (points.length === 1) {
    const p = points[0]
    return p ? [{ ...p }] : []
  }
  const lens: number[] = [0]
  let total = 0
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    if (!a || !b) continue
    total += Math.sqrt(sqDist(a, b))
    lens.push(total)
  }
  if (total === 0) {
    const p = points[0]
    return p ? [{ ...p }] : []
  }
  const out: SampledPoint[] = []
  let seg = 1
  for (let k = 0; k < n; k++) {
    const target = (total * k) / (n - 1)
    while (seg < points.length - 1 && (lens[seg] ?? 0) < target) seg++
    const a = points[seg - 1]
    const b = points[seg]
    const la = lens[seg - 1] ?? 0
    const lb = lens[seg] ?? 0
    if (!a || !b || lb === la) {
      out.push({ ...(a ?? b ?? { x: 0, y: 0, t: 0 }) })
      continue
    }
    const f = (target - la) / (lb - la)
    out.push({
      x: a.x + (b.x - a.x) * f,
      y: a.y + (b.y - a.y) * f,
      t: a.t + (b.t - a.t) * f,
    })
  }
  return out
}

function perpDistance(p: SampledPoint, a: SampledPoint, b: SampledPoint): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy)
  if (len === 0) return Math.hypot(p.x - a.x, p.y - a.y)
  return Math.abs(dy * (p.x - a.x) - dx * (p.y - a.y)) / len
}

/** Ramer–Douglas–Peucker simplification. */
export function simplify(points: readonly SampledPoint[], epsilon: number): SampledPoint[] {
  if (points.length <= 2) return [...points]
  let maxDist = 0
  let index = 0
  const first = points[0]
  const last = points[points.length - 1]
  if (!first || !last) return [...points]
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i]
    if (!p) continue
    const d = perpDistance(p, first, last)
    if (d > maxDist) {
      maxDist = d
      index = i
    }
  }
  if (maxDist > epsilon) {
    const left = simplify(points.slice(0, index + 1), epsilon)
    const right = simplify(points.slice(index), epsilon)
    return [...left.slice(0, -1), ...right]
  }
  return [first, last]
}

interface PathMeasures {
  straightness: number
  closure: number
  diag: number
  corners: SampledPoint[]
  totalTurn: number
}

function measure(path: readonly SampledPoint[]): PathMeasures {
  const first = path[0]
  const last = path[path.length - 1]
  const start = first ?? { x: 0, y: 0, t: 0 }
  const end = last ?? { x: 0, y: 0, t: 0 }
  let len = 0
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]
    const b = path[i]
    if (!a || !b) continue
    len += Math.hypot(b.x - a.x, b.y - a.y)
  }
  const endDist = Math.hypot(end.x - start.x, end.y - start.y)
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of path) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }
  const diag = Math.hypot(maxX - minX, maxY - minY) || 1
  const straightness = len > 0 ? endDist / len : 0
  const closure = endDist / diag

  const eps = Math.max(2.5, diag * 0.025)
  const verts = simplify([...path], eps)
  const corners: SampledPoint[] = []
  let totalTurn = 0
  for (let i = 1; i < verts.length - 1; i++) {
    const a = verts[i - 1]
    const b = verts[i]
    const c = verts[i + 1]
    if (!a || !b || !c) continue
    const a1 = Math.atan2(b.y - a.y, b.x - a.x)
    const a2 = Math.atan2(c.y - b.y, c.x - b.x)
    let turn = Math.abs(a2 - a1)
    if (turn > Math.PI) turn = 2 * Math.PI - turn
    totalTurn += turn
    if (turn > 35 * (Math.PI / 180)) corners.push(b)
  }
  return { straightness, closure, diag, corners, totalTurn }
}

function normAngleDelta(a: number, b: number): number {
  let d = Math.abs(a - b)
  if (d > Math.PI) d = 2 * Math.PI - d
  return d
}

function angleAt(path: readonly SampledPoint[], fromFrac: number, toFrac: number): number {
  const i1 = Math.min(path.length - 1, Math.floor(path.length * fromFrac))
  const i2 = Math.min(path.length - 1, Math.floor(path.length * toFrac))
  const a = path[i1]
  const b = path[i2]
  if (!a || !b) return 0
  return Math.atan2(b.y - a.y, b.x - a.x)
}

/**
 * Recognize a completed freehand gesture. Returns null when nothing clears
 * the conservative threshold — handwriting must never be "corrected" into
 * geometry by accident.
 */
export function recognizeShape(points: readonly SampledPoint[]): ShapeCandidate | null {
  if (points.length < MIN_POINTS) return null
  const path = resampleByArcLength(points, RESAMPLE_N)
  if (path.length < RESAMPLE_N / 2) return null
  const m = measure(path)
  const first = path[0]
  const last = path[path.length - 1]
  if (!first || !last) return null

  const candidates: ShapeCandidate[] = []

  // Open shapes: line and arrow.
  if (m.straightness >= 0.9) {
    candidates.push({ kind: 'line', x1: first.x, y1: first.y, x2: last.x, y2: last.y, score: m.straightness })
  }
  if (m.straightness >= 0.75 && m.straightness < 0.93) {
    // Arrow: mostly straight shaft, sharp direction change in the tail 15%.
    const shaft = angleAt(path, 0, 0.8)
    const tail = angleAt(path, 0.85, 1)
    const delta = normAngleDelta(shaft, tail)
    if (delta > 20 * (Math.PI / 180) && delta < 80 * (Math.PI / 180)) {
      candidates.push({ kind: 'arrow', x1: first.x, y1: first.y, x2: last.x, y2: last.y, score: m.straightness + 0.05 })
    }
  }

  // Closed shapes.
  if (m.closure <= 0.2) {
    const xs = path.map((p) => p.x)
    const ys = path.map((p) => p.y)
    const minX = Math.min(...xs)
    const minY = Math.min(...ys)
    const maxX = Math.max(...xs)
    const maxY = Math.max(...ys)
    const w = maxX - minX
    const h = maxY - minY

    if (m.corners.length === 4) {
      // Rectangle: four sharp corners and a closed convex total turn (~2π);
      // corner turns were already thresholded at 35° by measure().
      const right = m.totalTurn > 5.2 && m.totalTurn < 7.2
      if (right && w > 8 && h > 8) {
        candidates.push({ kind: 'rectangle', x1: minX, y1: minY, x2: maxX, y2: maxY, score: 0.8 + 0.2 * m.closure })
      }
    }

    // Ellipse: closed, few sharp corners, near-elliptical area fill.
    if (m.corners.length <= 2 && w > 8 && h > 8) {
      const area = polygonArea(path)
      const ellipseArea = Math.PI * (w / 2) * (h / 2)
      const ratio = ellipseArea > 0 ? area / ellipseArea : 0
      if (ratio > 0.68 && ratio < 1.32 && m.totalTurn > 5.0) {
        candidates.push({ kind: 'ellipse', x1: minX, y1: minY, x2: maxX, y2: maxY, score: 0.85 })
      }
    }
  }

  if (candidates.length === 0) return null
  let best: ShapeCandidate | null = null
  for (const c of candidates) {
    if (!best || c.score > best.score) best = c
  }
  if (!best || best.score < RECOGNIZE_THRESHOLD) return null
  return best
}

function polygonArea(path: readonly SampledPoint[]): number {
  let area = 0
  for (let i = 0; i < path.length; i++) {
    const a = path[i]
    const b = path[(i + 1) % path.length]
    if (!a || !b) continue
    area += a.x * b.y - b.x * a.y
  }
  return Math.abs(area) / 2
}
