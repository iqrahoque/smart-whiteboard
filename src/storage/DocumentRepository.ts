/**
 * IndexedDB repository (brief §9). A thin, promise-based wrapper over raw
 * IndexedDB — no ORM — keyed by notebook id. The factory is injectable for
 * deterministic tests (fake-indexeddb).
 *
 * The stored value is the versioned NotebookDoc JSON. Load failures are
 * surfaced, never silently overwritten: a corrupt record keeps its key and the
 * app starts a fresh notebook under a different id.
 */

import type { NotebookDoc } from '../documents/DocumentModel'

const DB_NAME = 'smart-whiteboard'
const DB_VERSION = 1
const STORE = 'notebooks'
/** Key of the notebook created on first run. */
export const DEFAULT_NOTEBOOK_ID = 'default'

export class StorageUnavailableError extends Error {
  constructor(cause: unknown) {
    super('IndexedDB is not available in this browser context')
    this.name = 'StorageUnavailableError'
    this.cause = cause
  }
}

export class DocumentRepository {
  private readonly factory: IDBFactory | undefined

  constructor(factory?: IDBFactory) {
    this.factory = factory
  }

  private openDb(): Promise<IDBDatabase> {
    const factory = this.factory ?? (typeof indexedDB !== 'undefined' ? indexedDB : undefined)
    if (!factory) return Promise.reject(new StorageUnavailableError(undefined))
    return new Promise((resolve, reject) => {
      const req = factory.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id' })
        }
      }
      req.onsuccess = () => {
        const db = req.result
        db.onversionchange = () => db.close()
        resolve(db)
      }
      req.onerror = () => reject(req.error ?? new Error('Failed to open IndexedDB'))
      req.onblocked = () => reject(new Error('IndexedDB upgrade blocked by another tab'))
    })
  }

  async load(id: string): Promise<NotebookDoc | null> {
    const db = await this.openDb()
    try {
      return await new Promise<NotebookDoc | null>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly')
        const req = tx.objectStore(STORE).get(id)
        req.onsuccess = () => resolve((req.result as NotebookDoc | undefined) ?? null)
        req.onerror = () => reject(req.error ?? new Error('Failed to read notebook'))
      })
    } finally {
      db.close()
    }
  }

  async save(notebook: NotebookDoc): Promise<void> {
    const db = await this.openDb()
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite')
        tx.objectStore(STORE).put(notebook)
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error ?? new Error('Failed to save notebook'))
        tx.onabort = () => reject(tx.error ?? new Error('Save transaction aborted'))
      })
    } finally {
      db.close()
    }
  }
}
