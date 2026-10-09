/**
 * Stroke rendering (document-space path drawing with round joins).
 *
 * The live preview and the committed document use the same painter, so what
 * you see while drawing is what you get after the stroke is committed.
 */

import type { SampledPoint, StrokeObject } from '../documents/DocumentModel'
import { strokeAlpha } from '../canvas/Painter'

/** Build a drawable stroke object from finalized points and tool style. */
export function makeStrokeObject(
  tool: StrokeObject['tool'],
  color: string,
  width: number,
  smoothing: StrokeObject['smoothing'],
  points: readonly SampledPoint[],
): StrokeObject {
  return {
    type: 'stroke',
    id: '', // assigned by the caller (DocumentController) on commit
    tool,
    color,
    width,
    smoothing,
    points: points.map((p) => ({ x: p.x, y: p.y, t: p.t })),
  }
}

/** Draw a stroke path into a context already in document space. */
export function traceStrokePath(ctx: CanvasRenderingContext2D, points: readonly SampledPoint[]): void {
  if (points.length === 0) return
  const first = points[0]
  if (!first) return
  ctx.beginPath()
  if (points.length === 1) {
    ctx.arc(first.x, first.y, 0.1, 0, Math.PI * 2)
    return
  }
  ctx.moveTo(first.x, first.y)
  for (let i = 1; i < points.length - 1; i++) {
    const cur = points[i]
    const next = points[i + 1]
    if (!cur || !next) continue
    ctx.quadraticCurveTo(cur.x, cur.y, (cur.x + next.x) / 2, (cur.y + next.y) / 2)
  }
  const last = points[points.length - 1]
  if (last) ctx.lineTo(last.x, last.y)
}

/** Stroke a live in-progress gesture with the given style. */
export function paintLiveStroke(
  ctx: CanvasRenderingContext2D,
  points: readonly SampledPoint[],
  color: string,
  width: number,
  tool: 'pen' | 'highlighter',
): void {
  if (points.length === 0) return
  ctx.save()
  ctx.strokeStyle = color
  ctx.globalAlpha = tool === 'highlighter' ? strokeAlpha({ type: 'stroke', id: '', tool, color, width, smoothing: 'balanced', points: [] }) : 1
  ctx.lineWidth = width
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  traceStrokePath(ctx, points)
  ctx.stroke()
  ctx.restore()
}
