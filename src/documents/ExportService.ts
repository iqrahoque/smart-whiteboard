/**
 * Import/export (brief §10). Exports: full-notebook JSON backups and per-page
 * PNG renders painted from document coordinates at a deliberate output scale.
 * Imports validate strictly before anything touches app state — invalid or
 * oversized files are rejected with a reason, never parsed leniently.
 */

import type { NotebookDoc, PageDoc, PageObject, SampledPoint } from './DocumentModel'
import { DOCUMENT_SCHEMA_VERSION, objectBounds } from './DocumentModel'
import { paintObject, paintPage } from '../canvas/Painter'
import type { ViewTransform } from '../canvas/CoordinateSystem'

/** Refuse files above this size before parsing (bytes). */
export const MAX_IMPORT_BYTES = 30 * 1024 * 1024
export const MAX_PAGES = 500
export const MAX_OBJECTS_PER_PAGE = 20_000

export class ImportValidationError extends Error {
  constructor(reason: string) {
    super(reason)
    this.name = 'ImportValidationError'
  }
}

export const NOTEBOOK_FILE_SCHEMA = 'smart-whiteboard-notebook'

export interface NotebookFile {
  schema: typeof NOTEBOOK_FILE_SCHEMA
  notebook: NotebookDoc
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function finiteNumber(v: unknown): boolean {
  return typeof v === 'number' && Number.isFinite(v)
}

function validPoints(v: unknown, count: number): v is SampledPoint[] {
  if (!Array.isArray(v) || v.length === 0 || v.length > 50_000) return false
  if (count > MAX_OBJECTS_PER_PAGE) return false
  return v.every(
    (p) => isRecord(p) && finiteNumber(p.x) && finiteNumber(p.y) && finiteNumber(p.t),
  )
}

function validObject(v: unknown): v is PageObject {
  if (!isRecord(v)) return false
  if (typeof v.id !== 'string' || v.id.length === 0 || v.id.length > 128) return false
  if (typeof v.color !== 'string' || v.color.length > 32) return false
  if (!finiteNumber(v.width) || (v.width as number) <= 0 || (v.width as number) > 200) return false
  if (v.type === 'stroke') {
    if ((v.tool !== 'pen' && v.tool !== 'highlighter') || typeof v.smoothing !== 'string') return false
    if (v.smoothing !== 'low' && v.smoothing !== 'balanced' && v.smoothing !== 'high') return false
    return validPoints(v.points, 1)
  }
  if (v.type === 'shape') {
    const kinds: unknown[] = ['line', 'rectangle', 'ellipse', 'arrow']
    if (!kinds.includes(v.kind)) return false
    return (
      finiteNumber(v.x1) && finiteNumber(v.y1) && finiteNumber(v.x2) && finiteNumber(v.y2)
    )
  }
  return false
}

function validPage(v: unknown): v is PageDoc {
  if (!isRecord(v)) return false
  if (typeof v.id !== 'string' || v.id.length === 0) return false
  if (typeof v.name !== 'string' || v.name.length > 200) return false
  if (typeof v.paperColor !== 'string' || v.paperColor.length > 32) return false
  const bgs: unknown[] = ['blank', 'ruled', 'dotted', 'grid']
  if (!bgs.includes(v.background)) return false
  if (!Array.isArray(v.objects) || v.objects.length > MAX_OBJECTS_PER_PAGE) return false
  if (!v.objects.every(validObject)) return false
  return finiteNumber(v.createdAt) && finiteNumber(v.updatedAt)
}

/**
 * Validate an imported notebook file. Throws ImportValidationError with a
 * human-readable reason. Returns the notebook only when fully valid.
 */
export function parseNotebookFile(json: unknown): NotebookDoc {
  if (!isRecord(json)) throw new ImportValidationError('File is not a JSON object.')
  if (json.schema !== NOTEBOOK_FILE_SCHEMA) {
    throw new ImportValidationError('File is not a Smart Whiteboard notebook backup.')
  }
  const nb = json.notebook
  if (!isRecord(nb)) throw new ImportValidationError('Backup has no notebook payload.')
  if (nb.schemaVersion !== DOCUMENT_SCHEMA_VERSION) {
    throw new ImportValidationError(
      `Unsupported schema version ${String(nb.schemaVersion)}; this app reads version ${DOCUMENT_SCHEMA_VERSION}.`,
    )
  }
  if (typeof nb.id !== 'string' || nb.id.length === 0) {
    throw new ImportValidationError('Backup notebook has no id.')
  }
  if (typeof nb.name !== 'string') throw new ImportValidationError('Backup notebook has no name.')
  if (!Array.isArray(nb.pages) || nb.pages.length === 0 || nb.pages.length > MAX_PAGES) {
    throw new ImportValidationError('Backup has an invalid page list.')
  }
  if (!nb.pages.every(validPage)) {
    throw new ImportValidationError('Backup contains an invalid page or object.')
  }
  return nb as unknown as NotebookDoc
}

export function toNotebookFile(notebook: NotebookDoc): NotebookFile {
  return { schema: NOTEBOOK_FILE_SCHEMA, notebook }
}

// ---------------------------------------------------------------------------
// Download helpers (browser only; no-ops guarded)
// ---------------------------------------------------------------------------

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  try {
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 5000)
  }
}

export function exportNotebookJson(notebook: NotebookDoc): void {
  const file = toNotebookFile(notebook)
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' })
  const safe = notebook.name.replace(/[^\w-]+/g, '_').slice(0, 40) || 'notebook'
  downloadBlob(blob, `${safe}-backup.json`)
}

export interface PngExportOptions {
  /** Output pixels per document unit (2 = retina-ish). Default 2. */
  scale?: number
  /** Include the paper background; when false the PNG is transparent. */
  includeBackground?: boolean
}

/**
 * Render one page to PNG from document coordinates — a deliberate render at
 * output scale, not a viewport screenshot.
 */
export async function exportPagePng(page: PageDoc, options: PngExportOptions = {}): Promise<void> {
  const scale = options.scale ?? 2
  const includeBackground = options.includeBackground ?? true

  const objects: PageObject[] = page.objects
  let bounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 }
  if (objects.length > 0) {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const o of objects) {
      const b = objectBounds(o)
      minX = Math.min(minX, b.minX)
      minY = Math.min(minY, b.minY)
      maxX = Math.max(maxX, b.maxX)
      maxY = Math.max(maxY, b.maxY)
    }
    const margin = 24
    bounds = { minX: minX - margin, minY: minY - margin, maxX: maxX + margin, maxY: maxY + margin }
  } else {
    bounds = { minX: 0, minY: 0, maxX: 800, maxY: 600 }
  }

  const widthDoc = Math.max(1, bounds.maxX - bounds.minX)
  const heightDoc = Math.max(1, bounds.maxY - bounds.minY)
  const canvas = document.createElement('canvas')
  canvas.width = Math.min(8192, Math.ceil(widthDoc * scale))
  canvas.height = Math.min(8192, Math.ceil(heightDoc * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D unavailable for export')

  const view: ViewTransform = {
    zoom: scale,
    panX: -bounds.minX,
    panY: -bounds.minY,
  }
  if (includeBackground) {
    paintPage(ctx, page, view, 1, canvas.width / scale, canvas.height / scale)
  } else {
    ctx.setTransform(scale, 0, 0, scale, -bounds.minX * scale, -bounds.minY * scale)
    for (const o of objects) paintObject(ctx, o)
  }

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('PNG encoding failed')
  const safe = page.name.replace(/[^\w-]+/g, '_').slice(0, 40) || 'page'
  downloadBlob(blob, `${safe}.png`)
}
