import type { JSX } from 'react'
import type { SaveState } from '../app/AppState'
import { SaveStatus } from './SaveStatus'

export interface TopBarProps {
  notebookName: string
  pageName: string
  zoomPercent: number
  saveState: SaveState
  theme: 'light' | 'dark'
  sidebarOpen: boolean
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  onExportPng: () => void
  onExportJson: () => void
  onImportJson: (file: File) => void
  onToggleTheme: () => void
  onToggleSidebar: () => void
  onToggleProperties: () => void
  onShowHelp: () => void
  propertiesOpen: boolean
}

function Icon({ d, filled = false }: { d: string; filled?: boolean }): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}

export function TopBar(props: TopBarProps): JSX.Element {
  const {
    notebookName,
    pageName,
    zoomPercent,
    saveState,
    theme,
    sidebarOpen,
    canUndo,
    canRedo,
    onUndo,
    onRedo,
    onExportPng,
    onExportJson,
    onImportJson,
    onToggleTheme,
    onToggleSidebar,
    onToggleProperties,
    onShowHelp,
    propertiesOpen,
  } = props

  const importRef = { current: null as HTMLInputElement | null }

  return (
    <header className="topbar">
      <button
        type="button"
        className="icon-btn"
        aria-pressed={sidebarOpen}
        title={sidebarOpen ? 'Hide pages panel' : 'Show pages panel'}
        aria-label="Toggle pages panel"
        onClick={onToggleSidebar}
      >
        <Icon d="M4 6h16M4 12h16M4 18h10" />
      </button>
      <button
        type="button"
        className="icon-btn"
        aria-pressed={propertiesOpen}
        title={propertiesOpen ? 'Hide properties' : 'Show properties'}
        aria-label="Toggle properties panel"
        onClick={onToggleProperties}
      >
        <Icon d="M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M6 14v6" />
      </button>

      <div className="topbar-title">
        <span className="notebook-name">{notebookName}</span>
        <span className="page-name" title={pageName}>· {pageName}</span>
      </div>

      <div className="topbar-actions">
        <button type="button" className="icon-btn" disabled={!canUndo} onClick={onUndo} title="Undo (Ctrl+Z)" aria-label="Undo">
          <Icon d="M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3" />
        </button>
        <button type="button" className="icon-btn" disabled={!canRedo} onClick={onRedo} title="Redo (Ctrl+Shift+Z)" aria-label="Redo">
          <Icon d="M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3" />
        </button>

        <span className="zoom-pill" title="Zoom (Ctrl+wheel, or Ctrl+= / Ctrl+-)">
          {zoomPercent}%
        </span>

        <SaveStatus state={saveState} />

        <button type="button" className="btn" onClick={onExportPng} title="Export this page as PNG">
          PNG
        </button>
        <button type="button" className="btn" onClick={onExportJson} title="Download a JSON backup of the notebook">
          Backup
        </button>
        <button type="button" className="btn" onClick={() => importRef.current?.click()} title="Import a notebook backup (.json)">
          Import
        </button>
        <input
          ref={(el) => {
            importRef.current = el
          }}
          type="file"
          accept="application/json,.json"
          className="visually-hidden"
          aria-label="Import notebook backup file"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) onImportJson(f)
            e.target.value = ''
          }}
        />

        <button type="button" className="icon-btn" onClick={onToggleTheme} title={theme === 'light' ? 'Switch to dark UI' : 'Switch to light UI'} aria-label="Toggle theme">
          {theme === 'light' ? <Icon d="M20 13A8 8 0 0 1 11 4a7 7 0 1 0 9 9z" /> : <Icon d="M12 4v2M12 18v2M4 12h2M18 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8z" />}
        </button>
        <button type="button" className="icon-btn" onClick={onShowHelp} title="Help and shortcuts (?)" aria-label="Help">
          <Icon d="M9.5 9a2.5 2.5 0 1 1 3.4 2.3c-.9.4-1.4 1-1.4 2v.7M12 17.5v.1" />
        </button>
      </div>
    </header>
  )
}
