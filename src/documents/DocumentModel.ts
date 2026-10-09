/**
 * Versioned document model for the Smart Whiteboard.
 *
 * Everything here is plain serializable data (JSON round-trip safe) with a
 * schema version, so notebooks can be stored in IndexedDB, exported to a file
 * and imported back, and migrated in the future without data loss.
 *
 * Coordinates are in *document space*: they do not change when the user zooms
 * or pans. Screen conversion lives in canvas/CoordinateSystem.ts.
 */

export const DOCUMENT_SCHEMA_VERSION = 1

export interface Point {
  x: number
  y: number
}

/** A single ink sample: document-space position plus a timestamp (ms). */
export interface SampledPoint extends Point {
  t: number
}

export type SmoothingPreset = 'low' | 'balanced' | 'high'

export type PaperStyle = 'blank' | 'ruled' | 'dotted' | 'grid'

export type InkTool = 'pen' | 'highlighter'

export type ShapeKind = 'line' | 'rectangle' | 'ellipse' | 'arrow'

export type ToolId =
  | 'pen'
  | 'highlighter'
  | 'eraser'
  | 'select'
  | 'line'
  | 'rectangle'
  | 'ellipse'
  | 'arrow'

interface BaseObject {
  /** Stable unique id; survives undo/redo, export and import. */
  id: string
}

/** Freehand ink. Points are the (lightly filtered) original samples. */
export interface StrokeObject extends BaseObject {
  type: 'stroke'
  tool: InkTool
  color: string
  /** Constant stroke width in document units. No pressure is assumed. */
  width: number
  smoothing: SmoothingPreset
  points: SampledPoint[]
}

/** A recognized or explicitly drawn geometric shape. */
export interface ShapeObject extends BaseObject {
  type: 'shape'
  kind: ShapeKind
  x1: number
  y1: number
  x2: number
  y2: number
  color: string
  width: number
}

export type PageObject = StrokeObject | ShapeObject

export interface PageDoc {
  id: string
  name: string
  background: PaperStyle
  /** Paper color is independent from the application theme. */
  paperColor: string
  objects: PageObject[]
  createdAt: number
  updatedAt: number
}

export interface NotebookDoc {
  schemaVersion: number
  id: string
  name: string
  pages: PageDoc[]
  createdAt: number
  updatedAt: number
}

// ---------------------------------------------------------------------------
// Constructors
// ---------------------------------------------------------------------------

export function createId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  // Deterministic environments without crypto.randomUUID (older runtimes).
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function createPage(name: string, now = Date.now()): PageDoc {
  return {
    id: createId(),
    name,
    background: 'grid',
    paperColor: '#ffffff',
    objects: [],
    createdAt: now,
    updatedAt: now,
  }
}

export function createNotebook(name = 'My notebook', now = Date.now()): NotebookDoc {
  return {
    schemaVersion: DOCUMENT_SCHEMA_VERSION,
    id: createId(),
    name,
    pages: [createPage('Page 1', now)],
    createdAt: now,
    updatedAt: now,
  }
}

export function createStroke(
  init: Pick<StrokeObject, 'tool' | 'color' | 'width' | 'smoothing' | 'points'>,
  id = createId(),
): StrokeObject {
  return { type: 'stroke', id, ...init }
}

export function createShape(
  init: Pick<ShapeObject, 'kind' | 'x1' | 'y1' | 'x2' | 'y2' | 'color' | 'width'>,
  id = createId(),
): ShapeObject {
  return { type: 'shape', id, ...init }
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

export function findPage(notebook: NotebookDoc, pageId: string): PageDoc | undefined {
  return notebook.pages.find((p) => p.id === pageId)
}

export function replacePage(notebook: NotebookDoc, nextPage: PageDoc): NotebookDoc {
  return {
    ...notebook,
    pages: notebook.pages.map((p) => (p.id === nextPage.id ? nextPage : p)),
    updatedAt: Date.now(),
  }
}

/** Bounding box of a single object in document space. */
export function objectBounds(obj: PageObject): { minX: number; minY: number; maxX: number; maxY: number } {
  if (obj.type === 'shape') {
    const minX = Math.min(obj.x1, obj.x2)
    const maxX = Math.max(obj.x1, obj.x2)
    const minY = Math.min(obj.y1, obj.y2)
    const maxY = Math.max(obj.y1, obj.y2)
    return { minX, minY, maxX, maxY }
  }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of obj.points) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 }
  return { minX, minY, maxX, maxY }
}

/** Union bounding box of several objects. */
export function unionBounds(objects: PageObject[]): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (objects.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const obj of objects) {
    const b = objectBounds(obj)
    minX = Math.min(minX, b.minX)
    minY = Math.min(minY, b.minY)
    maxX = Math.max(maxX, b.maxX)
    maxY = Math.max(maxY, b.maxY)
  }
  return { minX, minY, maxX, maxY }
}

export function translateObject<T extends PageObject>(obj: T, dx: number, dy: number): T {
  if (obj.type === 'shape') {
    return { ...obj, x1: obj.x1 + dx, y1: obj.y1 + dy, x2: obj.x2 + dx, y2: obj.y2 + dy }
  }
  return { ...obj, points: obj.points.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy })) }
}
