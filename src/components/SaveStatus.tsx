import type { JSX } from 'react'
import type { SaveState } from '../app/AppState'

export interface SaveStatusProps {
  state: SaveState
}

const LABELS: Record<SaveState, string> = {
  idle: '',
  saving: 'Saving…',
  saved: 'Saved',
  error: 'Save failed',
}

export function SaveStatus({ state }: SaveStatusProps): JSX.Element {
  if (state === 'idle') {
    return <span className="save-status" role="status" aria-label="Nothing to save" />
  }
  const cls =
    state === 'error'
      ? 'save-status error'
      : state === 'saving'
        ? 'save-status saving'
        : 'save-status saved'
  return (
    <span className={cls} role="status" aria-live="polite">
      <span className="save-dot" aria-hidden="true" />
      {LABELS[state]}
    </span>
  )
}
