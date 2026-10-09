/**
 * Persisted application settings (not document data).
 *
 * Settings are user preferences that survive reloads but are deliberately
 * kept OUT of the notebook document: a shared/exported notebook must never
 * carry one user's theme, snap or palm-workaround choices. Everything here
 * degrades safely — a corrupt or missing record falls back to defaults.
 */

export interface AppSettings {
  theme: 'light' | 'dark'
  /** Snap shape endpoints and moves to the grid. Off by default (natural). */
  snapEnabled: boolean
  /** Grid pitch in document units for snapping (8–96). */
  gridSize: number
  /**
   * Conservative auto shape recognition. Off by default: handwriting is
   * never converted to geometry unless this is explicitly enabled.
   */
  autoShape: boolean
  /**
   * Ignore extra simultaneous contacts while a gesture is active. This is a
   * best-effort workaround, NOT palm rejection — a capacitive stylus is a
   * finger to the hardware.
   */
  ignoreExtraContacts: boolean
  /** The first-run hint is shown until dismissed once. */
  hintDismissed: boolean
}

/** Ink palette for pen and highlighter. */
export const INK_COLORS: readonly string[] = [
  '#1d1d1f',
  '#0a84ff',
  '#e0483e',
  '#2fa84f',
  '#f5a623',
  '#8e5bd6',
  '#8e8e93',
]

/** Paper color palette (independent from the UI theme). */
export const PAPER_COLORS: readonly string[] = [
  '#ffffff',
  '#f6f4ee',
  '#fdf6dd',
  '#eef4fa',
  '#f3eefb',
  '#202124',
]

export const MIN_GRID_SIZE = 8
export const MAX_GRID_SIZE = 96

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'light',
  snapEnabled: false,
  gridSize: 24,
  autoShape: false,
  ignoreExtraContacts: true,
  hintDismissed: false,
}

const STORAGE_KEY = 'smart-whiteboard-settings-v1'

function clampGridSize(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : DEFAULT_SETTINGS.gridSize
  return Math.min(MAX_GRID_SIZE, Math.max(MIN_GRID_SIZE, n))
}

function pickBool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback
}

/**
 * Load settings from localStorage. Any problem — private mode, quota,
 * corrupt JSON, wrong types — yields safe defaults rather than a crash.
 */
export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { ...DEFAULT_SETTINGS }
    }
    const p = parsed as Partial<AppSettings>
    return {
      theme: p.theme === 'dark' ? 'dark' : 'light',
      snapEnabled: pickBool(p.snapEnabled, DEFAULT_SETTINGS.snapEnabled),
      gridSize: clampGridSize(p.gridSize),
      autoShape: pickBool(p.autoShape, DEFAULT_SETTINGS.autoShape),
      ignoreExtraContacts: pickBool(p.ignoreExtraContacts, DEFAULT_SETTINGS.ignoreExtraContacts),
      hintDismissed: pickBool(p.hintDismissed, DEFAULT_SETTINGS.hintDismissed),
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

/** Best-effort persistence; failures (quota, private mode) are silent. */
export function persistSettings(settings: AppSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // Settings stay in-memory for this session; nothing else to do.
  }
}
