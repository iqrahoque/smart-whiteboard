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

  it('serializes overlapping saves so the newest write lands last', async () => {
    // The first write is artificially slow AFTER the queue would have let the
    // second write start: without serialized saves the stale record would
    // commit last and win.
    class SlowFirstWriteRepo extends DocumentRepository {
      private slowed = false
      protected override async writeNotebook(nb: Parameters<DocumentRepository['save']>[0]): Promise<void> {
        if (!this.slowed) {
          this.slowed = true
          await new Promise((resolve) => setTimeout(resolve, 25))
        }
        await super.writeNotebook(nb)
      }
    }
    const r = new SlowFirstWriteRepo(new IDBFactory() as unknown as IDBFactory)
    const nb = createNotebook('older')
    const first = r.save(nb)
    await r.save({ ...nb, name: 'newer' })
    await first
    expect((await r.load(nb.id))?.name).toBe('newer')
  })

  it('a failed save does not poison the write queue for later saves', async () => {
    class FailOnceRepo extends DocumentRepository {
      private failed = false
      protected override async writeNotebook(nb: Parameters<DocumentRepository['save']>[0]): Promise<void> {
        if (!this.failed) {
          this.failed = true
          throw new Error('injected write failure')
        }
        await super.writeNotebook(nb)
      }
    }
    const r = new FailOnceRepo(new IDBFactory() as unknown as IDBFactory)
    const nb = createNotebook('after failure')
    await expect(r.save(nb)).rejects.toThrow('injected write failure')
    await r.save({ ...nb, name: 'recovered' })
    expect((await r.load(nb.id))?.name).toBe('recovered')
  })
})
