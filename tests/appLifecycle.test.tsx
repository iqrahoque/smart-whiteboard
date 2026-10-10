import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { App } from '../src/app/App'
import { DocumentRepository } from '../src/storage/DocumentRepository'

/**
 * App lifecycle regressions (task brief §4 Issues B and C).
 *
 * This file deliberately installs fake-indexeddb globally (unlike the rest of
 * the suite): vitest isolates test files, so other files still see a storage-
 * free jsdom. Fake IndexedDB lets us assert what the app actually persisted.
 *
 * NOTE: the toolbar renders before the async storage load finishes, so tests
 * must wait for the loaded page list before interacting with the document.
 */

afterEach(() => {
  vi.restoreAllMocks()
})

describe('App lifecycle', () => {
  it('persists the latest document when unmounting while an autosave is pending', async () => {
    const { unmount } = render(<App />)
    // Wait for the storage load to finish (sidebar lists the loaded page).
    expect(await screen.findByText('Page 1')).toBeTruthy()

    // A page operation schedules the 500 ms debounced autosave.
    fireEvent.click(screen.getByRole('button', { name: /\+ new page/i }))
    expect(await screen.findByText('Page 2')).toBeTruthy()

    // Unmount well inside the debounce window: cleanup must flush the pending
    // write instead of dropping it. (The test reaches unmount in milliseconds,
    // so the debounce is provably still pending here.)
    unmount()

    // Give the flushed async write time to settle, then read the store back.
    await new Promise((resolve) => setTimeout(resolve, 120))
    const loaded = await new DocumentRepository().load('default')
    expect(loaded?.id).toBe('default')
    expect(loaded?.pages.map((p) => p.name)).toContain('Page 2')
  })

  it('registers its window blur listener with a stable reference and removes it on unmount', () => {
    const addSpy = vi.spyOn(window, 'addEventListener')
    const removeSpy = vi.spyOn(window, 'removeEventListener')
    const { unmount } = render(<App />)

    // The mount effects have run: at least one window 'blur' listener exists.
    const added = addSpy.mock.calls.filter(([type]) => type === 'blur').map(([, h]) => h)
    expect(added.length).toBeGreaterThanOrEqual(1)

    unmount()

    // Every registered 'blur' handler must be removed by the exact same
    // reference — an anonymous listener here would accumulate forever.
    const removed = removeSpy.mock.calls.filter(([type]) => type === 'blur').map(([, h]) => h)
    for (const handler of added) {
      expect(removed).toContain(handler)
    }

    addSpy.mockRestore()
    removeSpy.mockRestore()
  })
})
