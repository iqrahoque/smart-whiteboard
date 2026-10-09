/**
 * Ink pipeline (brief §5 "Stroke processing").
 *
 *   raw samples → validate → de-duplicate → smooth → finalized points
 *
 * Smoothing is an exponential filter whose first and last samples are
 * re-anchored to the raw endpoints, so strokes keep their true endpoints while
 * jitter between them is reduced. Constant width is the default everywhere:
 * no pressure data is assumed from a capacitive stylus.
 */

import type { SampledPoint, SmoothingPreset } from '../documents/DocumentModel'

/** Exponential filter responsiveness per preset (1 = raw, lower = smoother). */
export const SMOOTHING_ALPHA: Record<SmoothingPreset, number> = {
  low: 0.75,
  balanced: 0.45,
  high: 0.22,
}

/** Samples closer than this distance (document units) are duplicates. */
export const DUPLICATE_EPSILON = 0.5

/** Hard cap so a pathological event stream cannot exhaust memory. */
export const MAX_SAMPLES = 8000

function isFinitePoint(p: SampledPoint): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.t)
}

function sqDist(a: SampledPoint, b: SampledPoint): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return dx * dx + dy * dy
}

/**
 * Filter one gesture's raw samples into drawable points.
 *
 * - Non-finite coordinates are rejected.
 * - Near-identical consecutive samples are de-duplicated (spatial epsilon);
 *   the raw first and last samples are always kept so the gesture endpoints
 *   stay exact.
 * - Jitter is reduced with the preset's exponential filter; endpoints are
 *   re-anchored afterwards.
 * - Never produces NaN or infinite coordinates; never returns empty for a
 *   non-empty valid input.
 */
export function processRawSamples(raw: readonly SampledPoint[], preset: SmoothingPreset): SampledPoint[] {
  const valid = raw.filter(isFinitePoint)
  if (valid.length === 0) return []

  // Uniform subsample of pathological streams (keeps first and last sample).
  let samples: SampledPoint[] = valid
  if (samples.length > MAX_SAMPLES) {
    const step = samples.length / MAX_SAMPLES
    const reduced: SampledPoint[] = []
    for (let i = 0; i < MAX_SAMPLES; i++) {
      const s = samples[Math.floor(i * step)]
      if (s) reduced.push(s)
    }
    const lastRaw = valid[valid.length - 1]
    if (lastRaw) reduced.push(lastRaw)
    samples = reduced
  }

  // De-duplicate while preserving order and the final endpoint.
  const eps2 = DUPLICATE_EPSILON * DUPLICATE_EPSILON
  const deduped: SampledPoint[] = []
  for (const p of samples) {
    const prev = deduped[deduped.length - 1]
    if (prev && sqDist(prev, p) < eps2) continue
    deduped.push(p)
  }
  if (deduped.length === 0) return []
  if (deduped.length === 1) {
    const only = deduped[0]
    return only ? [only] : []
  }

  // Exponential smoothing; endpoints re-anchored to the raw gesture.
  const alpha = SMOOTHING_ALPHA[preset] ?? SMOOTHING_ALPHA.balanced
  const first = deduped[0]
  const last = deduped[deduped.length - 1]
  if (!first || !last) return []
  const out: SampledPoint[] = [{ ...first }]
  for (let i = 1; i < deduped.length - 1; i++) {
    const cur = deduped[i]
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

/** Euclidean length of a polyline. */
export function pathLength(points: readonly SampledPoint[]): number {
  let len = 0
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    if (!a || !b) continue
    len += Math.sqrt(sqDist(a, b))
  }
  return len
}
