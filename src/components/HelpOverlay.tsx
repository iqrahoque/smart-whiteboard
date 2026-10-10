import type { JSX } from 'react'

export interface HelpOverlayProps {
  open: boolean
  onClose: () => void
}

const SHORTCUTS: Array<[string, string]> = [
  ['P / H', 'Pen / Highlighter'],
  ['E / V', 'Eraser / Select'],
  ['T', 'Text: drag a box over handwriting to convert it'],
  ['L / R / O / A', 'Line / Rectangle / Ellipse / Arrow'],
  ['N', 'Navigate mode (pan & zoom without drawing)'],
  ['Space (hold)', 'Temporary pan'],
  ['Ctrl+Z / Ctrl+Shift+Z or Ctrl+Y', 'Undo / Redo'],
  ['Delete', 'Erase the current selection'],
  ['Ctrl+= / Ctrl+- / Ctrl+0', 'Zoom in / out / reset'],
  ['Ctrl+wheel', 'Zoom at pointer'],
  ['PageUp / PageDown', 'Previous / next page'],
  ['Alt+N', 'New page'],
  ['?', 'Toggle this help'],
  ['Esc', 'Close dialogs · clear selection'],
]

const HONEST_NOTES: string[] = [
  'A capacitive stylus is seen by the hardware as a finger: there is no pressure, no hover and no pen identity. Line width is constant.',
  '“Ignore extra contacts” is a best-effort workaround, not palm rejection — a resting palm is just another touch. Stray marks can be undone with Ctrl+Z.',
  'Your notes live only in this browser (IndexedDB). Clearing site data erases them — export a JSON backup regularly.',
  'Shape recognition is conservative geometric matching, not AI: ambiguous strokes always stay freehand.',
  'Handwriting-to-text runs fully offline by template matching. It reads clear, separated block letters best; cursive and slanted writing will often refuse (ink stays untouched) or guess wrong. Converted text stays fully editable.',
]

/** Modal help: keyboard shortcuts plus honest notes about input limits. */
export function HelpOverlay({ open, onClose }: HelpOverlayProps): JSX.Element | null {
  if (!open) return null
  return (
    <div
      className="overlay-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="help-overlay" role="dialog" aria-modal="true" aria-label="Help and shortcuts">
        <div className="help-head">
          <h2>Help &amp; shortcuts</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close help" title="Close (Esc)">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <h3 className="help-subtitle">Keyboard</h3>
        <table className="help-table">
          <tbody>
            {SHORTCUTS.map(([keys, desc]) => (
              <tr key={keys}>
                <td><kbd>{keys}</kbd></td>
                <td>{desc}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h3 className="help-subtitle">Honest input notes</h3>
        <ul className="help-notes">
          {HONEST_NOTES.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </div>
    </div>
  )
}
