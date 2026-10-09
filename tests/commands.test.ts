import { describe, expect, it } from 'vitest'
import { findPage } from '../src/documents/DocumentModel'
import { createNotebook, createPage, createShape, createStroke } from '../src/documents/DocumentModel'
import {
  addPageCommand,
  addObjectCommand,
  clearPageCommand,
  moveObjectsCommand,
  removeObjectsCommand,
} from '../src/documents/Commands'
import { DocumentController, HISTORY_LIMIT } from '../src/documents/DocumentController'

function strokeAt(x: number) {
  return createStroke({ tool: 'pen', color: '#000', width: 2, smoothing: 'balanced', points: [{ x, y: 0, t: 0 }] })
}

describe('Commands + DocumentController', () => {
  it('adds an object and removes it on undo', () => {
    const nb = createNotebook()
    const pageId = nb.pages[0]?.id ?? ''
    const controller = new DocumentController(nb)
    const stroke = strokeAt(10)
    controller.dispatch(addObjectCommand(pageId, stroke))
    expect(controller.getHistory().undoCount).toBe(1)
    expect(controller.getNotebook().pages[0]?.objects).toHaveLength(1)
    controller.undo()
    expect(controller.getNotebook().pages[0]?.objects).toHaveLength(0)
    controller.redo()
    expect(controller.getNotebook().pages[0]?.objects).toHaveLength(1)
  })

  it('removes objects and restores them on undo (append semantics)', () => {
    const nb = createNotebook()
    const pageId = nb.pages[0]?.id ?? ''
    const controller = new DocumentController(nb)
    const a = strokeAt(1)
    const b = strokeAt(2)
    controller.dispatch(addObjectCommand(pageId, a))
    controller.dispatch(addObjectCommand(pageId, b))
    controller.dispatch(removeObjectsCommand(pageId, [a]))
    expect(controller.getNotebook().pages[0]?.objects.map((o) => o.id)).toEqual([b.id])
    controller.undo()
    // Revert re-appends the removed objects at the end of the z-order.
    expect(controller.getNotebook().pages[0]?.objects.map((o) => o.id)).toEqual([b.id, a.id])
  })

  it('moves objects and reverts the translation', () => {
    const nb = createNotebook()
    const pageId = nb.pages[0]?.id ?? ''
    const shape = createShape({ kind: 'rectangle', x1: 0, y1: 0, x2: 10, y2: 10, color: '#000', width: 2 })
    const controller = new DocumentController(nb)
    controller.dispatch(addObjectCommand(pageId, shape))
    controller.dispatch(moveObjectsCommand(pageId, [shape.id], 15, -5))
    const moved = controller.getNotebook().pages[0]?.objects[0]
    if (moved?.type === 'shape') {
      expect(moved.x1).toBe(15)
      expect(moved.y2).toBe(5)
    } else {
      throw new Error('expected shape')
    }
    controller.undo()
    const restored = controller.getNotebook().pages[0]?.objects[0]
    if (restored?.type === 'shape') {
      expect(restored.x1).toBe(0)
      expect(restored.y2).toBe(10)
    } else {
      throw new Error('expected shape')
    }
  })

  it('clears a page and restores everything on undo', () => {
    const nb = createNotebook()
    const pageId = nb.pages[0]?.id ?? ''
    const controller = new DocumentController(nb)
    controller.dispatch(addObjectCommand(pageId, strokeAt(1)))
    controller.dispatch(addObjectCommand(pageId, strokeAt(2)))
    controller.dispatch(clearPageCommand(pageId))
    expect(controller.getNotebook().pages[0]?.objects).toHaveLength(0)
    controller.undo()
    expect(controller.getNotebook().pages[0]?.objects).toHaveLength(2)
  })

  it('caps the undo history at HISTORY_LIMIT', () => {
    const nb = createNotebook()
    const pageId = nb.pages[0]?.id ?? ''
    const controller = new DocumentController(nb)
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) {
      controller.dispatch(addObjectCommand(pageId, strokeAt(i)))
    }
    expect(controller.getHistory().undoCount).toBe(HISTORY_LIMIT)
  })

  it('clears the redo stack on a new command', () => {
    const nb = createNotebook()
    const pageId = nb.pages[0]?.id ?? ''
    const controller = new DocumentController(nb)
    controller.dispatch(addObjectCommand(pageId, strokeAt(1)))
    controller.undo()
    expect(controller.getHistory().canRedo).toBe(true)
    controller.dispatch(addObjectCommand(pageId, strokeAt(2)))
    expect(controller.getHistory().canRedo).toBe(false)
  })

  it('adds and removes pages reversibly', () => {
    const nb = createNotebook()
    const controller = new DocumentController(nb)
    const page = createPage('Page 2')
    controller.dispatch(addPageCommand(page))
    expect(controller.getNotebook().pages).toHaveLength(2)
    expect(findPage(controller.getNotebook(), page.id)).toBeTruthy()
    controller.undo()
    expect(controller.getNotebook().pages).toHaveLength(1)
  })
})
