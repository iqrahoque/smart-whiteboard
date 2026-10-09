import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { App } from '../src/app/App'

describe('App smoke', () => {
  it('renders the shell and can add a page', async () => {
    render(<App />)
    // Toolbar appears once the notebook has loaded (jsdom has no IndexedDB,
    // so the app starts a fresh in-memory notebook and shows a warning).
    expect(await screen.findByRole('toolbar')).toBeTruthy()
    expect(await screen.findByRole('alert')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /\+ new page/i }))
    expect(await screen.findByText('Page 2')).toBeTruthy()

    // The canvas host is mounted with an accessible label.
    expect(screen.getByRole('img', { name: /whiteboard drawing canvas/i })).toBeTruthy()
  })
})
