/**
 * Command-based, reversible history (brief §9 "Undo/redo architecture").
 *
 * A command is a pair of pure transforms on the notebook document. Commands
 * never mutate their input; `apply` and `revert` return the next state. This
 * keeps undo/redo trivially correct and avoids cloning the document on every
 * pointer sample (commands are created on gesture *completion*, not per point).
 */

import type { NotebookDoc, PageDoc, PageObject, PaperStyle, ShapeKind } from './DocumentModel'
import { findPage, replacePage, translateObject } from './DocumentModel'

export interface DocCommand {
  readonly label: string
  apply(notebook: NotebookDoc): NotebookDoc
  revert(notebook: NotebookDoc): NotebookDoc
}

function updatePageObjects(
  notebook: NotebookDoc,
  pageId: string,
  transform: (objects: PageObject[]) => PageObject[],
): NotebookDoc | null {
  const page = findPage(notebook, pageId)
  if (!page) return null
  const nextPage: PageDoc = { ...page, objects: transform(page.objects), updatedAt: Date.now() }
  return replacePage(notebook, nextPage)
}

/** Add one object (stroke, shape, ...). Revert removes exactly that id. */
export function addObjectCommand(pageId: string, obj: PageObject): DocCommand {
  return {
    label: 'Add object',
    apply: (nb) => updatePageObjects(nb, pageId, (objs) => [...objs, obj]) ?? nb,
    revert: (nb) => updatePageObjects(nb, pageId, (objs) => objs.filter((o) => o.id !== obj.id)) ?? nb,
  }
}

/** Remove a set of objects (eraser gestures, delete key). */
export function removeObjectsCommand(pageId: string, removed: readonly PageObject[]): DocCommand {
  const ids = new Set(removed.map((o) => o.id))
  return {
    label: 'Remove objects',
    apply: (nb) => updatePageObjects(nb, pageId, (objs) => objs.filter((o) => !ids.has(o.id))) ?? nb,
    revert: (nb) => updatePageObjects(nb, pageId, (objs) => [...objs, ...removed]) ?? nb,
  }
}

/** Replace one object with another keeping its z-order (e.g. stroke → shape). */
export function replaceObjectCommand(pageId: string, before: PageObject, after: PageObject): DocCommand {
  return {
    label: 'Update object',
    apply: (nb) =>
      updatePageObjects(nb, pageId, (objs) => objs.map((o) => (o.id === before.id ? after : o))) ?? nb,
    revert: (nb) =>
      updatePageObjects(nb, pageId, (objs) => objs.map((o) => (o.id === after.id ? before : o))) ?? nb,
  }
}

/** Translate a set of objects by (dx, dy) in document space. */
export function moveObjectsCommand(pageId: string, ids: readonly string[], dx: number, dy: number): DocCommand {
  const idSet = new Set(ids)
  return {
    label: 'Move objects',
    apply: (nb) =>
      updatePageObjects(nb, pageId, (objs) => objs.map((o) => (idSet.has(o.id) ? translateObject(o, dx, dy) : o))) ??
      nb,
    revert: (nb) =>
      updatePageObjects(nb, pageId, (objs) => objs.map((o) => (idSet.has(o.id) ? translateObject(o, -dx, -dy) : o))) ??
      nb,
  }
}

/** Erase everything on a page. Revert restores all removed objects. */
export function clearPageCommand(pageId: string): DocCommand {
  let removed: PageObject[] = []
  return {
    label: 'Clear page',
    apply: (nb) => {
      const page = findPage(nb, pageId)
      removed = page ? page.objects : []
      return updatePageObjects(nb, pageId, () => []) ?? nb
    },
    revert: (nb) => updatePageObjects(nb, pageId, (objs) => [...objs, ...removed]) ?? nb,
  }
}

/** Change a page's paper style and/or paper color; both reversible. */
export function changePageStyleCommand(
  pageId: string,
  style: { background?: PaperStyle; paperColor?: string },
): DocCommand {
  let before: { background?: PaperStyle; paperColor?: string } = {}
  return {
    label: 'Change paper',
    apply: (nb) => {
      const page = findPage(nb, pageId)
      if (!page) return nb
      before = {}
      if (style.background !== undefined && style.background !== page.background) before.background = page.background
      if (style.paperColor !== undefined && style.paperColor !== page.paperColor) before.paperColor = page.paperColor
      if (Object.keys(before).length === 0) return nb
      const nextPage: PageDoc = { ...page, updatedAt: Date.now() }
      if (style.background !== undefined) nextPage.background = style.background
      if (style.paperColor !== undefined) nextPage.paperColor = style.paperColor
      return replacePage(nb, nextPage)
    },
    revert: (nb) => {
      const page = findPage(nb, pageId)
      if (!page) return nb
      return replacePage(nb, { ...page, ...before, updatedAt: Date.now() })
    },
  }
}

/** Add a pre-created page at an index (default: end). Undo removes it again. */
export function addPageCommand(page: PageDoc, index?: number): DocCommand {
  const at = index ?? Number.POSITIVE_INFINITY
  return {
    label: 'New page',
    apply: (nb) => {
      const pages = [...nb.pages]
      pages.splice(Math.min(at, pages.length), 0, page)
      return { ...nb, pages, updatedAt: Date.now() }
    },
    revert: (nb) => ({ ...nb, pages: nb.pages.filter((p) => p.id !== page.id), updatedAt: Date.now() }),
  }
}

export function removePageCommand(pageId: string): DocCommand {
  let removed: PageDoc | undefined
  let index = -1
  return {
    label: 'Delete page',
    apply: (nb) => {
      index = nb.pages.findIndex((p) => p.id === pageId)
      removed = index >= 0 ? nb.pages[index] : undefined
      if (index < 0 || !removed) return nb
      return { ...nb, pages: nb.pages.filter((p) => p.id !== pageId), updatedAt: Date.now() }
    },
    revert: (nb) => {
      if (index < 0 || !removed) return nb
      const pages = [...nb.pages]
      pages.splice(Math.min(index, pages.length), 0, removed)
      return { ...nb, pages, updatedAt: Date.now() }
    },
  }
}

export function renamePageCommand(pageId: string, name: string): DocCommand {
  let before = ''
  return {
    label: 'Rename page',
    apply: (nb) => {
      const page = findPage(nb, pageId)
      if (!page) return nb
      before = page.name
      return replacePage(nb, { ...page, name, updatedAt: Date.now() })
    },
    revert: (nb) => {
      const page = findPage(nb, pageId)
      if (!page) return nb
      return replacePage(nb, { ...page, name: before, updatedAt: Date.now() })
    },
  }
}

/** Swap an object's geometry (used by snapping/alignment on shape commit). */
export function setShapeGeometryCommand(
  pageId: string,
  id: string,
  geometry: { kind?: ShapeKind; x1: number; y1: number; x2: number; y2: number },
): DocCommand {
  let beforeShape: PageObject | undefined
  return {
    label: 'Snap shape',
    apply: (nb) =>
      updatePageObjects(nb, pageId, (objs) =>
        objs.map((o) => {
          if (o.id !== id) return o
          beforeShape = o
          return o.type === 'shape' ? { ...o, ...geometry } : o
        }),
      ) ?? nb,
    revert: (nb) =>
      updatePageObjects(nb, pageId, (objs) => objs.map((o) => (beforeShape && o.id === beforeShape.id ? beforeShape : o))) ??
      nb,
  }
}
