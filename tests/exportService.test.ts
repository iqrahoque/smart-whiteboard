import { describe, expect, it } from 'vitest'
import {
  ImportValidationError,
  MAX_IMPORT_BYTES,
  NOTEBOOK_FILE_SCHEMA,
  parseNotebookFile,
  toNotebookFile,
} from '../src/documents/ExportService'
import { createNotebook, createStroke } from '../src/documents/DocumentModel'

function validFile(): unknown {
  const nb = createNotebook('Import test')
  const page = nb.pages[0]
  if (!page) throw new Error('expected a page')
  page.objects.push(
    createStroke({
      tool: 'highlighter',
      color: '#f5a623',
      width: 12,
      smoothing: 'low',
      points: [
        { x: 0, y: 0, t: 0 },
        { x: 10, y: 1, t: 1 },
      ],
    }),
  )
  return toNotebookFile(nb)
}

describe('ExportService.parseNotebookFile', () => {
  it('accepts a valid notebook file', () => {
    const nb = parseNotebookFile(validFile())
    expect(nb.name).toBe('Import test')
    expect(nb.pages).toHaveLength(1)
    expect(nb.pages[0]?.objects).toHaveLength(1)
  })

  it('rejects non-objects and wrong schemas', () => {
    expect(() => parseNotebookFile('nope')).toThrow(ImportValidationError)
    expect(() => parseNotebookFile([])).toThrow(ImportValidationError)
    expect(() => parseNotebookFile({ schema: 'other', notebook: {} })).toThrow(/not a Smart Whiteboard/)
    expect(() => parseNotebookFile({ schema: NOTEBOOK_FILE_SCHEMA })).toThrow(/no notebook payload/)
  })

  it('rejects wrong schema versions', () => {
    const file = validFile() as { notebook: { schemaVersion: number } }
    file.notebook.schemaVersion = 999
    expect(() => parseNotebookFile(file)).toThrow(/schema version/)
  })

  it('rejects invalid pages and objects', () => {
    const noPages = validFile() as { notebook: { pages: unknown[] } }
    noPages.notebook.pages = []
    expect(() => parseNotebookFile(noPages)).toThrow(/page list/)

    const badObject = validFile() as { notebook: { pages: Array<{ objects: unknown[] }> } }
    badObject.notebook.pages[0]!.objects = [{ type: 'stroke', id: '', color: '', width: -1, points: [] }]
    expect(() => parseNotebookFile(badObject)).toThrow(/invalid page or object/)
  })

  it('exposes the import size cap', () => {
    expect(MAX_IMPORT_BYTES).toBe(30 * 1024 * 1024)
  })
})
