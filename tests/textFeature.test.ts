/**
 * Tests for the text-object plumbing: the convert command (undo/redo keeps
 * z-order), text editing command, bounds/hit-testing and import validation.
 */

import { describe, expect, it } from 'vitest'
import type { NotebookDoc, PageObject, StrokeObject, TextObject } from '../src/documents/DocumentModel'
import {
  createNotebook,
  createStroke,
  createText,
  objectBounds,
  translateObject,
} from '../src/documents/DocumentModel'
import {
  convertStrokesToTextCommand,
  removeObjectsCommand,
  updateTextCommand,
} from '../src/documents/Commands'
import { parseNotebookFile } from '../src/documents/ExportService'
import { hitTestObject } from '../src/geometry/hitTesting'

function sampleStroke(id: string, x: number, y: number): StrokeObject {
  return createStroke(
    {
      tool: 'pen',
      color: '#1d1d1f',
      width: 3,
      smoothing: 'balanced',
      points: [
        { x, y, t: 0 },
        { x: x + 20, y: y + 30, t: 10 },
      ],
    },
    id,
  )
}

function sampleText(over: Partial<TextObject> = {}): TextObject {
  return createText({ x: 10, y: 10, text: 'Hello', color: '#1d1d1f', fontSize: 40, ...over })
}

function notebookWith(objects: PageObject[]): NotebookDoc {
  const nb = createNotebook()
  nb.pages[0]!.objects.push(...objects)
  return nb
}

describe('convertStrokesToTextCommand', () => {
  it('replaces strokes with text and restores them on undo', () => {
    const s1 = sampleStroke('s1', 0, 0)
    const s2 = sampleStroke('s2', 100, 0)
    const other = sampleStroke('other', 500, 0)
    const text = sampleText()
    const nb = notebookWith([s1, s2, other])
    const cmd = convertStrokesToTextCommand(nb.pages[0]!.id, [s1, s2], text)

    const applied = cmd.apply(nb)
    const ids = applied.pages[0]!.objects.map((o) => o.id)
    expect(ids).toEqual([text.id, other.id])

    const reverted = cmd.revert(applied)
    expect(reverted.pages[0]!.objects.map((o) => o.id)).toEqual(['s1', 's2', 'other'])
  })

  it('keeps the strokes at their original z-order after undo', () => {
    const s1 = sampleStroke('s1', 0, 0)
    const before = sampleStroke('before', -50, 0)
    const after = sampleStroke('after', 500, 0)
    const text = sampleText()
    const nb = notebookWith([before, s1, after])
    const cmd = convertStrokesToTextCommand(nb.pages[0]!.id, [s1], text)

    const applied = cmd.apply(nb)
    expect(applied.pages[0]!.objects.map((o) => o.id)).toEqual(['before', text.id, 'after'])
    const reverted = cmd.revert(applied)
    expect(reverted.pages[0]!.objects.map((o) => o.id)).toEqual(['before', 's1', 'after'])
  })

  it('works through a full undo/redo cycle via the controller', async () => {
    const { DocumentController } = await import('../src/documents/DocumentController')
    const s1 = sampleStroke('s1', 0, 0)
    const text = sampleText()
    const controller = new DocumentController(notebookWith([s1]))
    controller.dispatch(convertStrokesToTextCommand(controller.getNotebook().pages[0]!.id, [s1], text))
    expect(controller.getNotebook().pages[0]!.objects.map((o) => o.type)).toEqual(['text'])

    controller.undo()
    const restored = controller.getNotebook().pages[0]!.objects
    expect(restored).toHaveLength(1)
    expect(restored[0]).toMatchObject({ type: 'stroke', id: 's1' })

    controller.redo()
    expect(controller.getNotebook().pages[0]!.objects[0]?.type).toBe('text')
  })

  it('removing the text afterwards still lets undo restore the strokes', () => {
    const s1 = sampleStroke('s1', 0, 0)
    const text = sampleText()
    const nb = notebookWith([s1])
    const convert = convertStrokesToTextCommand(nb.pages[0]!.id, [s1], text)
    const nb2 = convert.apply(nb)
    const remove = removeObjectsCommand(nb2.pages[0]!.id, [text])
    const nb3 = remove.apply(nb2)
    expect(nb3.pages[0]!.objects).toHaveLength(0)
    const nb4 = remove.revert(nb3)
    expect(nb4.pages[0]!.objects.map((o) => o.id)).toEqual([text.id])
    const nb5 = convert.revert(nb4)
    expect(nb5.pages[0]!.objects.map((o) => o.id)).toEqual(['s1'])
  })
})

describe('updateTextCommand', () => {
  it('patches fields and reverts them', () => {
    const text = sampleText()
    const nb = notebookWith([text])
    const cmd = updateTextCommand(nb.pages[0]!.id, text.id, { text: 'Hello world', fontSize: 60 })
    const applied = cmd.apply(nb)
    const obj = applied.pages[0]!.objects[0] as TextObject
    expect(obj.text).toBe('Hello world')
    expect(obj.fontSize).toBe(60)
    const reverted = cmd.revert(applied)
    const restored = reverted.pages[0]!.objects[0] as TextObject
    expect(restored.text).toBe('Hello')
    expect(restored.fontSize).toBe(40)
  })

  it('is a no-op when nothing changes', () => {
    const text = sampleText()
    const nb = notebookWith([text])
    const cmd = updateTextCommand(nb.pages[0]!.id, text.id, { text: text.text })
    expect(cmd.apply(nb)).toBe(nb)
  })
})

describe('text object model', () => {
  it('bounds use the registered measurement when present, else the estimate', () => {
    const text = sampleText({ x: 50, y: 60 })
    const est = objectBounds(text)
    expect(est.minX).toBe(50)
    expect(est.minY).toBe(60)
    expect(est.maxX).toBeGreaterThan(50)
    expect(est.maxY).toBeGreaterThan(60)
  })

  it('translates by (dx, dy)', () => {
    const text = sampleText()
    const moved = translateObject(text, 15, -5)
    expect(moved.x).toBe(25)
    expect(moved.y).toBe(5)
  })

  it('hit-tests inside the padded bounds', () => {
    const text = sampleText({ x: 100, y: 100, text: 'Ab', fontSize: 40 })
    // Estimate: width ≈ 2 chars * 40 * 0.62 = 49.6, height ≈ 40.
    expect(hitTestObject(text, { x: 120, y: 115 }, 4, 'area')).toBe(true)
    expect(hitTestObject(text, { x: 300, y: 300 }, 4, 'area')).toBe(false)
  })
})

describe('notebook import validation with text objects', () => {
  it('accepts a valid text object', () => {
    const nb = notebookWith([sampleText()])
    const file = { schema: 'smart-whiteboard-notebook', notebook: nb }
    const parsed = parseNotebookFile(file)
    expect(parsed.pages[0]!.objects[0]!.type).toBe('text')
  })

  it('rejects text objects with non-finite positions or bad sizes', () => {
    const bad = [
      sampleText({ x: Number.NaN }),
      sampleText({ fontSize: 0 }),
      sampleText({ fontSize: 2000 }),
      sampleText({ text: '' }),
    ]
    for (const obj of bad) {
      const file = { schema: 'smart-whiteboard-notebook', notebook: notebookWith([obj]) }
      expect(() => parseNotebookFile(file)).toThrow()
    }
  })

  it('rejects text objects with missing color', () => {
    const obj = sampleText() as unknown as Record<string, unknown>
    delete obj.color
    const file = { schema: 'smart-whiteboard-notebook', notebook: notebookWith([obj as unknown as TextObject]) }
    expect(() => parseNotebookFile(file)).toThrow()
  })
})
