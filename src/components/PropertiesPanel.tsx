import type { JSX } from 'react'
import type { PaperStyle, ToolId } from '../documents/DocumentModel'
import type { InkStyle } from '../canvas/InputController'
import {
  INK_COLORS,
  MAX_GRID_SIZE,
  MIN_GRID_SIZE,
  PAPER_COLORS,
  type AppSettings,
} from '../app/settings'

export interface PropertiesPanelProps {
  tool: ToolId
  ink: InkStyle
  onInkChange: (patch: Partial<InkStyle>) => void
  paper: { background: PaperStyle; paperColor: string }
  onPaperChange: (patch: { background?: PaperStyle; paperColor?: string }) => void
  settings: AppSettings
  onSettingsChange: (patch: Partial<AppSettings>) => void
  onClearPage: () => void
}

const PAPERS: Array<{ id: PaperStyle; label: string }> = [
  { id: 'blank', label: 'Blank' },
  { id: 'ruled', label: 'Ruled' },
  { id: 'dotted', label: 'Dotted' },
  { id: 'grid', label: 'Grid' },
]

const SMOOTHING: Array<{ id: InkStyle['smoothing']; label: string }> = [
  { id: 'low', label: 'Low' },
  { id: 'balanced', label: 'Balanced' },
  { id: 'high', label: 'High' },
]

function Swatches({
  colors,
  value,
  label,
  onPick,
}: {
  colors: readonly string[]
  value: string
  label: string
  onPick: (c: string) => void
}): JSX.Element {
  return (
    <div className="swatches" role="group" aria-label={label}>
      {colors.map((c) => (
        <button
          key={c}
          type="button"
          className={`swatch ${value === c ? 'active' : ''}`}
          style={{ background: c }}
          title={c}
          aria-pressed={value === c}
          aria-label={`${label} ${c}`}
          onClick={() => onPick(c)}
        />
      ))}
    </div>
  )
}

export function PropertiesPanel(props: PropertiesPanelProps): JSX.Element {
  const { tool, ink, onInkChange, paper, onPaperChange, settings, onSettingsChange, onClearPage } = props
  const inkActive = tool === 'pen' || tool === 'highlighter'

  return (
    <aside className="properties" aria-label="Properties">
      <section className="prop-section">
        <h3 className="prop-title">Ink</h3>
        <Swatches colors={INK_COLORS} value={ink.color} label="Ink color" onPick={(color) => onInkChange({ color })} />
        <label className="prop-row">
          <span className="prop-label">Width</span>
          <input
            type="range"
            min={1}
            max={24}
            step={1}
            value={ink.width}
            aria-label="Ink width"
            onChange={(e) => onInkChange({ width: Number(e.target.value) })}
          />
          <span className="prop-value">{ink.width}</span>
        </label>
        <div className="prop-row" role="group" aria-label="Smoothing">
          <span className="prop-label">Smoothing</span>
          <div className="chip-row">
            {SMOOTHING.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`chip ${ink.smoothing === s.id ? 'active' : ''}`}
                aria-pressed={ink.smoothing === s.id}
                disabled={!inkActive}
                title={inkActive ? `${s.label} smoothing` : 'Switch to pen or highlighter first'}
                onClick={() => onInkChange({ smoothing: s.id })}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="prop-section">
        <h3 className="prop-title">Paper</h3>
        <div className="chip-row" role="group" aria-label="Paper style">
          {PAPERS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`chip ${paper.background === p.id ? 'active' : ''}`}
              aria-pressed={paper.background === p.id}
              onClick={() => onPaperChange({ background: p.id })}
            >
              {p.label}
            </button>
          ))}
        </div>
        <Swatches
          colors={PAPER_COLORS}
          value={paper.paperColor}
          label="Paper color"
          onPick={(paperColor) => onPaperChange({ paperColor })}
        />
        <div className="prop-row">
          <button
            type="button"
            className="btn danger"
            onClick={onClearPage}
            title="Erase everything on this page (asks for confirmation)"
          >
            Clear page
          </button>
        </div>
      </section>

      <section className="prop-section">
        <h3 className="prop-title">Diagram aids</h3>
        <label className="prop-row toggle">
          <input
            type="checkbox"
            checked={settings.snapEnabled}
            onChange={(e) => onSettingsChange({ snapEnabled: e.target.checked })}
          />
          <span>Snap to grid</span>
        </label>
        <label className="prop-row">
          <span className="prop-label">Grid size</span>
          <input
            type="range"
            min={MIN_GRID_SIZE}
            max={MAX_GRID_SIZE}
            step={2}
            value={settings.gridSize}
            disabled={!settings.snapEnabled}
            aria-label="Grid size"
            onChange={(e) => onSettingsChange({ gridSize: Number(e.target.value) })}
          />
          <span className="prop-value">{settings.gridSize}</span>
        </label>
        <label className="prop-row toggle">
          <input
            type="checkbox"
            checked={settings.autoShape}
            title="Conservative: handwriting is never auto-converted to shapes unless enabled"
            onChange={(e) => onSettingsChange({ autoShape: e.target.checked })}
          />
          <span>Recognize shapes (pen only)</span>
        </label>
        <label className="prop-row toggle">
          <input
            type="checkbox"
            checked={settings.ignoreExtraContacts}
            title="Best-effort workaround, NOT palm rejection — a capacitive stylus is a finger to the hardware. Stray marks can be undone with Ctrl+Z."
            onChange={(e) => onSettingsChange({ ignoreExtraContacts: e.target.checked })}
          />
          <span>Ignore extra contacts</span>
        </label>
      </section>
    </aside>
  )
}
