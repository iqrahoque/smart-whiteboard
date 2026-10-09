# Smart Whiteboard

A local-first, handwritten whiteboard and study notebook, built for a
**capacitive stylus on a Windows touchscreen laptop** — and it works with a
finger or a mouse anywhere else too. Everything runs in your browser; your
notes never leave your device.

**Live app:** https://iqrahoque.github.io/smart-whiteboard/

## Features

- **Natural ink** — pen and highlighter with three smoothing presets; strokes
  keep their true endpoints while jitter between them is reduced.
- **Pages** — add, duplicate, rename (inline) and delete pages inside one
  notebook; autosaved to IndexedDB after every change.
- **Paper** — blank / ruled / dotted / grid backgrounds and a paper color
  palette, per page.
- **Shapes** — draw line, rectangle, ellipse and arrow directly, or (optionally)
  let conservative geometric recognition convert a clean pen stroke into a
  shape. Ambiguous strokes always stay freehand; recognition is off by default.
- **Eraser** — object-level erasing with a visible halo cursor.
- **Select & move** — tap to select (Shift for multi-select), drag to move,
  with grid snapping and alignment guides.
- **Navigate mode** — pan by dragging, pinch or Ctrl+wheel to zoom (0.2×–5×),
  or hold Space for temporary panning in any tool.
- **Undo/redo** — full command history (200 steps) for every document change.
- **Export / import** — per-page PNG rendered from document coordinates at 2×
  scale, plus full-notebook JSON backups you can re-import.
- **Themes** — light and dark UI.

## What is deliberately NOT implemented

Honesty about limits, so there are no surprises:

- **No pressure or hover sensitivity.** A capacitive stylus is seen by the
  hardware as a finger — there is no pen identity, no pressure data, no hover.
  Line width is constant per stroke.
- **No true palm rejection.** "Ignore extra contacts" is a best-effort
  workaround: while a gesture is active, additional simultaneous touches are
  ignored. A resting palm is still just another contact — if a stray mark
  slips through, Ctrl+Z removes it.
- **No lasso selection, no text boxes, no image/PDF import.** Ink and shapes
  only, on purpose.
- **No cloud sync.** Storage is IndexedDB in this browser, this profile.

## Backups (please read)

Your notes live **only** in this browser. Clearing site data, private-browsing
modes, or a browser cleanup tool will erase them permanently.

- Export regularly: **Backup** (top bar) downloads a JSON file of the whole
  notebook.
- Restore: **Import** replaces the current notebook after strict validation
  (invalid or oversized files are rejected with a reason, never parsed
  leniently).
- Keep at least one backup outside the browser if the notes matter.

## Development

```bash
npm install
npm run dev        # serves under /smart-whiteboard/ (http://localhost:5173/smart-whiteboard/)
npm run test:run   # vitest suite
npm run lint       # eslint
npm run build      # typecheck + production build into dist/
```

The app is served under the `/smart-whiteboard/` base path by default so the
same build works on GitHub Pages project sites. Override it for other hosts:

```bash
VITE_BASE_PATH=/ npm run build   # serve from the domain root
```

## Deploying to GitHub Pages

The included workflow (`.github/workflows/deploy.yml`) builds, lints, tests and
deploys on every push to `main`. One manual step is required the first time:

**Settings → Pages → Build and deployment → Source: "GitHub Actions"**

## Architecture notes

- **Document model** (`src/documents/`) — versioned, JSON-safe data with pure
  reversible commands and a 200-step undo/redo controller.
- **Input pipeline** (`src/canvas/InputController.ts`) — a pointer state
  machine outside React: one gesture at a time, pointer capture, coalesced
  events, pinch and wheel handling. React never re-renders per input sample.
- **Rendering** (`src/canvas/Renderer.ts`, `Painter.ts`) — a committed offscreen
  layer presented through rAF; live ink, selection, guides and eraser cursor
  are drawn on top. Backgrounds are DPR-aligned to stay crisp without moiré.
- **Storage** (`src/storage/DocumentRepository.ts`) — a thin promise wrapper
  over IndexedDB with an injectable factory for tests; corrupt records are
  surfaced, never silently overwritten.

## Troubleshooting

- **"Save failed"** — storage may be blocked (private mode, disabled site
  data). Export a backup and move to a normal window.
- **Stray marks while writing** — keep "Ignore extra contacts" enabled and
  avoid resting the palm mid-stroke; undo handles the rest.
- **Notes disappeared** — you are probably in a different browser, profile or
  private window. Notes are per browser profile; restore from a backup.
- **Zoom seems stuck** — Ctrl+0 resets to 100%.
