import { describe, expect, it } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { DocumentRepository } from '../src/storage/DocumentRepository'
import { createNotebook, createStroke } from '../src/documents/DocumentModel'

function repo(): DocumentRepository {
  return new DocumentRepository(new IDBFactory() as unknown as IDBFactory)
}

describe('DocumentRepository (fake-indexeddb)', () => {
  it('round-trips a notebook', async () => {
    const r = repo()
    const nb = createNotebook('Stored')
    const page = nb.pages[0]
    if (!page) throw new Error('expected a page')
    page.objects.push(
      createStroke({
        tool: 'pen',
        color: '#000',
        width: 2,
        smoothing: 'balanced',
        points: [{ x: 1, y: 2, t: 3 }],
      }),
    )
    await r.save(nb)
    const loaded = await r.load(nb.id)
    expect(loaded).toEqual(nb)
  })

  it('returns null for a missing id', async () => {
    const r = repo()
    expect(await r.load('does-not-exist')).toBeNull()
  })

  it('keeps separate factories isolated', async () => {
    const a = repo()
    const b = repo()
    const nb = createNotebook('Only in A')
    await a.save(nb)
    expect(await a.load(nb.id)).toBeTruthy()
    expect(await b.load(nb.id)).toBeNull()
  })

  it('updates an existing record (put semantics)', async () => {
    const r = repo()
    const nb = createNotebook('v1')
    await r.save(nb)
    const renamed = { ...nb, name: 'v2' }
    await r.save(renamed)
    const loaded = await r.load(nb.id)
    expect(loaded?.name).toBe('v2')
  })
})
