import type { JSX } from 'react'
import type { ToolId } from '../documents/DocumentModel'

export interface ToolbarProps {
  tool: ToolId
  navigateMode: boolean
  onToolChange: (tool: ToolId) => void
  onToggleNavigate: () => void
}

const PEN_ICON = 'M4 20l2.5-8L16 2.5 21.5 8 12 17.5 4 20z'
const HIGHLIGHTER_ICON = 'M4 17h6l9-9-4-4-9 9-2 4zM3 21h18'
const ERASER_ICON = 'M7 21h10M5 15l8-8 6 6-6 6H9l-4-4z'
const SELECT_ICON = 'M5 3l14 8-6 1.5L16 19l-3 1.5-3-6.5L5 17V3z'
const LINE_ICON = 'M4 20L20 4'
const RECTANGLE_ICON = 'M4 6h16v12H4z'
const ELLIPSE_ICON = 'M12 5c4.5 0 8 3.1 8 7s-3.5 7-8 7-8-3.1-8-7 3.5-7 8-7z'
const ARROW_ICON = 'M4 20L19 5M19 5v6M19 5h-6'

const TOOL_ITEMS: Array<{ id: ToolId; label: string; shortcut: string; icon: string }> = [
  { id: 'pen', label: 'Pen', shortcut: 'P', icon: PEN_ICON },
  { id: 'highlighter', label: 'Highlighter', shortcut: 'H', icon: HIGHLIGHTER_ICON },
  { id: 'eraser', label: 'Eraser', shortcut: 'E', icon: ERASER_ICON },
  { id: 'select', label: 'Select', shortcut: 'V', icon: SELECT_ICON },
  { id: 'line', label: 'Line', shortcut: 'L', icon: LINE_ICON },
  { id: 'rectangle', label: 'Rectangle', shortcut: 'R', icon: RECTANGLE_ICON },
  { id: 'ellipse', label: 'Ellipse', shortcut: 'O', icon: ELLIPSE_ICON },
  { id: 'arrow', label: 'Arrow', shortcut: 'A', icon: ARROW_ICON },
]

function ToolIcon({ d }: { d: string }): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}

export function Toolbar(props: ToolbarProps): JSX.Element {
  const { tool, navigateMode, onToolChange, onToggleNavigate } = props
  return (
    <div className="toolbar" role="toolbar" aria-label="Drawing tools">
      <button
        type="button"
        className={`tool-btn mode-btn ${navigateMode ? 'active' : ''}`}
        aria-pressed={navigateMode}
        title={navigateMode ? 'Navigate mode: drag pans, pinch or Ctrl+wheel zooms (N to exit)' : 'Switch to Navigate mode (N) — pan and zoom without drawing'}
        onClick={onToggleNavigate}
      >
        <ToolIcon d="M9 5l-6 7 6 7M15 5l6 7-6 7" />
        <span className="tool-btn-label">{navigateMode ? 'Navigate' : 'Draw'}</span>
      </button>

      <div className="toolbar-sep" role="presentation" />

      {TOOL_ITEMS.map((t) => (
        <button
          key={t.id}
          type="button"
          className={`tool-btn ${tool === t.id && !navigateMode ? 'active' : ''}`}
          aria-pressed={tool === t.id && !navigateMode}
          disabled={navigateMode}
          title={`${t.label} (${t.shortcut})`}
          onClick={() => onToolChange(t.id)}
        >
          <ToolIcon d={t.icon} />
          <span className="sr-only">{t.label}</span>
        </button>
      ))}
    </div>
  )
}
