import { describe, expect, it } from 'vitest'
import {
  createNotebook,
  createPage,
  createShape,
  createStroke,
  objectBounds,
  translateObject,
  unionBounds,
} from '../src/documents/DocumentModel'
import type { NotebookDoc, PageDoc } from '../src/documents/DocumentModel'

describe('DocumentModel', () => {
  it('survives a JSON round-trip', () => {
    const nb = createNotebook('Round trip')
    const page = nb.pages[0]
    if (!page) throw new Error('expected a page')
    page.objects.push(
      createStroke({
        tool: 'pen',
        color: '#123456',
        width: 3,
        smoothing: 'high',
        points: [
          { x: 1, y: 2, t: 3 },
          { x: 4, y: 5, t: 6 },
        ],
      }),
    )
    page.objects.push(createShape({ kind: 'arrow', x1: 0, y1: 0, x2: 9, y2: -9, color: '#000', width: 2 }))
    const back: NotebookDoc = JSON.parse(JSON.stringify(nb)) as NotebookDoc
    expect(back).toEqual(nb)
  })

  it('computes bounds for strokes and shapes (including negatives)', () => {
    const stroke = createStroke({
      tool: 'pen',
      color: '#000',
      width: 1,
      smoothing: 'balanced',
      points: [
        { x: -10, y: -20, t: 0 },
        { x: 30, y: 5, t: 1 },
        { x: 0, y: 40, t: 2 },
      ],
    })
    expect(objectBounds(stroke)).toEqual({ minX: -10, minY: -20, maxX: 30, maxY: 40 })

    const shape = createShape({ kind: 'line', x1: 5, y1: 50, x2: -5, y2: 10, color: '#000', width: 1 })
    expect(objectBounds(shape)).toEqual({ minX: -5, minY: 10, maxX: 5, maxY: 50 })
  })

  it('unions bounds across objects', () => {
    const a = createShape({ kind: 'rectangle', x1: 0, y1: 0, x2: 10, y2: 10, color: '#000', width: 1 })
    const b = createShape({ kind: 'rectangle', x1: 20, y1: -5, x2: 30, y2: 8, color: '#000', width: 1 })
    expect(unionBounds([a, b])).toEqual({ minX: 0, minY: -5, maxX: 30, maxY: 10 })
    expect(unionBounds([])).toBeNull()
  })

  it('translates strokes and shapes without mutating the input', () => {
    const shape = createShape({ kind: 'rectangle', x1: 0, y1: 0, x2: 10, y2: 10, color: '#000', width: 1 })
    const moved = translateObject(shape, 5, 7)
    expect({ x1: moved.x1, y1: moved.y1 }).toEqual({ x1: 5, y1: 7 })
    expect(shape.x1).toBe(0)

    const stroke = createStroke({
      tool: 'pen',
      color: '#000',
      width: 1,
      smoothing: 'balanced',
      points: [{ x: 1, y: 1, t: 0 }],
    })
    const movedStroke = translateObject(stroke, 2, 3)
    expect(movedStroke.points[0]).toEqual({ x: 3, y: 4, t: 0 })
    expect(stroke.points[0]).toEqual({ x: 1, y: 1, t: 0 })
  })

  it('creates pages with unique ids and a stable schema version', () => {
    const a = createPage('A')
    const b = createPage('B')
    expect(a.id).not.toBe(b.id)
    expect(createNotebook().schemaVersion).toBe(1)
  })

  it('replaces a page by id', () => {
    const nb = createNotebook()
    const page = nb.pages[0] as PageDoc
    const next: PageDoc = { ...page, name: 'Renamed' }
    const nb2 = { ...nb, pages: nb.pages.map((p) => (p.id === page.id ? next : p)) }
    expect(nb2.pages[0]?.name).toBe('Renamed')
    expect(nb.pages[0]?.name).not.toBe('Renamed')
  })
})
