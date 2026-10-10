import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { NotebookDoc, PageDoc, ToolId } from '../documents/DocumentModel'
import { createId, createNotebook, createPage, findPage } from '../documents/DocumentModel'
import {
  addPageCommand,
  changePageStyleCommand,
  clearPageCommand,
  removePageCommand,
  renamePageCommand,
} from '../documents/Commands'
import { DocumentController } from '../documents/DocumentController'
import type { HistoryState } from '../documents/DocumentController'
import {
  exportNotebookJson,
  exportPagePng,
  MAX_IMPORT_BYTES,
  parseNotebookFile,
} from '../documents/ExportService'
import { DEFAULT_NOTEBOOK_ID, DocumentRepository } from '../storage/DocumentRepository'
import type { InkStyle } from '../canvas/InputController'
import { WhiteboardCanvas } from '../canvas/WhiteboardCanvas'
import type { AppBridge } from '../canvas/WhiteboardCanvas'
import type { ViewTransform } from '../canvas/CoordinateSystem'
import { NotebookSidebar } from '../components/NotebookSidebar'
import { PropertiesPanel } from '../components/PropertiesPanel'
import { Toolbar } from '../components/Toolbar'
import { TopBar } from '../components/TopBar'
import { HelpOverlay } from '../components/HelpOverlay'
import { buildAppBridge } from './bridge'
import type { BridgeExtras } from './bridge'
import type { SaveState } from './AppState'
import { INK_COLORS, loadSettings, persistSettings } from './settings'
import type { AppSettings } from './settings'
import type { TextObject } from '../documents/DocumentModel'
import { updateTextCommand } from '../documents/Commands'

const INITIAL_HISTORY: HistoryState = { canUndo: false, canRedo: false, undoCount: 0, redoCount: 0 }

/** Minimal structural check for a record coming back from IndexedDB. */
function looksLikeNotebook(v: NotebookDoc | null): v is NotebookDoc {
  return (
    !!v &&
    typeof v.id === 'string' &&
    v.id.length > 0 &&
    Array.isArray(v.pages) &&
    v.pages.length > 0 &&
    v.pages.every((p) => !!p && typeof p.id === 'string' && Array.isArray(p.objects))
  )
}

export function App(): JSX.Element {
  const [settings, setSettings] = useState<AppSettings>(loadSettings)
  const [tool, setTool] = useState<ToolId>('pen')
  const [ink, setInk] = useState<InkStyle>({
    color: INK_COLORS[0] ?? '#1d1d1f',
    width: 3,
    smoothing: 'balanced',
  })
  const [notebook, setNotebook] = useState<NotebookDoc | null>(null)
  const [pageId, setPageId] = useState('')
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [history, setHistory] = useState<HistoryState>(INITIAL_HISTORY)
  const [zoomPercent, setZoomPercent] = useState(100)
  const [helpOpen, setHelpOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [propertiesOpen, setPropertiesOpen] = useState(true)
  const [navigateMode, setNavigateMode] = useState(false)
  const [storageWarning, setStorageWarning] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [selectionVersion, bumpSelection] = useReducer((n: number) => n + 1, 0)
  const noticeTimerRef = useRef<number | null>(null)

  // Lazy singletons (stable identities for the bridge and effects).
  const controllerRef = useRef<DocumentController | null>(null)
  if (!controllerRef.current) controllerRef.current = new DocumentController(createNotebook())
  const controller = controllerRef.current

  const repoRef = useRef<DocumentRepository | null>(null)
  if (!repoRef.current) repoRef.current = new DocumentRepository()
  const repo = repoRef.current

  // Refs the bridge reads on every input event — kept fresh, never re-render.
  const toolRef = useRef<ToolId>('pen')
  const styleRef = useRef<InkStyle>({ color: INK_COLORS[0] ?? '#1d1d1f', width: 3, smoothing: 'balanced' })
  const settingsRef = useRef<AppSettings>(settings)
  const pageIdRef = useRef('')
  const navigateRef = useRef(false)
  const spaceRef = useRef(false)
  const saveTimerRef = useRef<number | null>(null)
  const zoomTimerRef = useRef<number | null>(null)

  // Subscribe before the initial load so replaceDocument triggers one save.
  useEffect(() => {
    const scheduleSave = (nb: NotebookDoc): void => {
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
      setSaveState('saving')
      saveTimerRef.current = window.setTimeout(() => {
        saveTimerRef.current = null
        repo.save(nb).then(
          () => setSaveState('saved'),
          () => setSaveState('error'),
        )
      }, 500)
    }
    const unsub = controller.subscribe(() => {
      const nb = controller.getNotebook()
      setNotebook(nb)
      setHistory(controller.getHistory())
      scheduleSave(nb)
    })
    const flush = (): void => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
        void repo.save(controller.getNotebook()).catch(() => setSaveState('error'))
      }
    }
    window.addEventListener('pagehide', flush)
    window.addEventListener('blur', () => {
      spaceRef.current = false
    })
    return () => {
      unsub()
      window.removeEventListener('pagehide', flush)
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
    }
  }, [controller, repo])

  // Initial load: stored notebook → corrupt → fresh → storage unavailable.
  useEffect(() => {
    void repo
      .load(DEFAULT_NOTEBOOK_ID)
      .then((loaded) => {
        if (looksLikeNotebook(loaded)) {
          controller.replaceDocument(loaded)
          setPageId(loaded.pages[0]?.id ?? '')
          return
        }
        if (loaded !== null) {
          // Corrupt record: keep it on disk, start fresh under a new id.
          const fresh = createNotebook()
          controller.replaceDocument(fresh)
          setPageId(fresh.pages[0]?.id ?? '')
          setStorageWarning(
            'Saved notes could not be read (corrupt record) — started a fresh notebook. The original data is still on disk; export backups regularly.',
          )
          return
        }
        // First run: create the default notebook so the next load finds it.
        const fresh: NotebookDoc = { ...createNotebook(), id: DEFAULT_NOTEBOOK_ID }
        controller.replaceDocument(fresh)
        setPageId(fresh.pages[0]?.id ?? '')
      })
      .catch(() => {
        const fresh = createNotebook()
        controller.replaceDocument(fresh)
        setPageId(fresh.pages[0]?.id ?? '')
        setStorageWarning(
          'Browser storage is unavailable, so notes will not persist this session. Export backups from the top bar.',
        )
      })
  }, [controller, repo])

  // Keep the bridge's refs in sync with committed state.
  useEffect(() => {
    toolRef.current = tool
    styleRef.current = ink
    settingsRef.current = settings
    pageIdRef.current = pageId
    navigateRef.current = navigateMode
  }, [tool, ink, settings, pageId, navigateMode])

  useEffect(() => {
    persistSettings(settings)
  }, [settings])

  const bridge = useMemo<AppBridge & BridgeExtras>(
    () =>
      buildAppBridge({
        tool: toolRef,
        style: styleRef,
        settings: settingsRef,
        pageId: pageIdRef,
        navigateMode: navigateRef,
        spacePanning: spaceRef,
        controller,
        onViewChanged: (v: ViewTransform) => {
          if (zoomTimerRef.current !== null) window.clearTimeout(zoomTimerRef.current)
          zoomTimerRef.current = window.setTimeout(() => {
            zoomTimerRef.current = null
            setZoomPercent(Math.round(v.zoom * 100))
          }, 250)
        },
        onNotice: (message: string) => {
          setNotice(message)
          if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current)
          noticeTimerRef.current = window.setTimeout(() => {
            noticeTimerRef.current = null
            setNotice(null)
          }, 4200)
        },
        onSelectionChanged: () => {
          bumpSelection()
        },
      }),
    [controller],
  )

  // ----- Page operations ----------------------------------------------------

  const addPage = useCallback(() => {
    const nb = controller.getNotebook()
    const page = createPage(`Page ${nb.pages.length + 1}`)
    controller.dispatch(addPageCommand(page))
    setPageId(page.id)
  }, [controller])

  const duplicatePage = useCallback(
    (id: string) => {
      const src = findPage(controller.getNotebook(), id)
      if (!src) return
      const now = Date.now()
      const copy: PageDoc = {
        ...src,
        id: createId(),
        name: `${src.name} copy`,
        objects: src.objects.map((o) =>
          o.type === 'stroke'
            ? { ...o, id: createId(), points: o.points.map((p) => ({ ...p })) }
            : { ...o, id: createId() },
        ),
        createdAt: now,
        updatedAt: now,
      }
      controller.dispatch(addPageCommand(copy))
      setPageId(copy.id)
    },
    [controller],
  )

  const deletePage = useCallback(
    (id: string) => {
      const nb = controller.getNotebook()
      if (nb.pages.length <= 1) return
      const page = findPage(nb, id)
      if (!page) return
      if (!window.confirm(`Delete "${page.name}"? This cannot be undone.`)) return
      const index = nb.pages.findIndex((p) => p.id === id)
      const next = nb.pages[index + 1] ?? nb.pages[index - 1] ?? nb.pages[0]
      controller.dispatch(removePageCommand(id))
      if (pageIdRef.current === id && next) setPageId(next.id)
    },
    [controller],
  )

  const renamePage = useCallback(
    (id: string, name: string) => {
      controller.dispatch(renamePageCommand(id, name))
    },
    [controller],
  )

  const clearPage = useCallback(() => {
    const page = findPage(controller.getNotebook(), pageIdRef.current)
    if (!page || page.objects.length === 0) return
    if (!window.confirm(`Clear everything on "${page.name}"? You can undo this.`)) return
    controller.dispatch(clearPageCommand(page.id))
    bridge.clearSelection()
  }, [controller, bridge])

  // ----- Import / export ----------------------------------------------------

  const exportPng = useCallback(() => {
    const page = findPage(controller.getNotebook(), pageIdRef.current)
    if (!page) return
    void exportPagePng(page).catch(() => window.alert('PNG export failed.'))
  }, [controller])

  const exportJson = useCallback(() => {
    exportNotebookJson(controller.getNotebook())
  }, [controller])

  const importJson = useCallback(
    (file: File) => {
      if (file.size > MAX_IMPORT_BYTES) {
        window.alert(`File is too large (max ${Math.round(MAX_IMPORT_BYTES / (1024 * 1024))} MB).`)
        return
      }
      void file
        .text()
        .then((text) => {
          let parsed: unknown
          try {
            parsed = JSON.parse(text)
          } catch {
            window.alert('That file is not valid JSON.')
            return
          }
          try {
            const nb = parseNotebookFile(parsed)
            if (
              !window.confirm(
                `Import "${nb.name}" (${nb.pages.length} page${nb.pages.length === 1 ? '' : 's'})? This replaces the current notebook.`,
              )
            ) {
              return
            }
            controller.replaceDocument(nb)
            setPageId(nb.pages[0]?.id ?? '')
            setStorageWarning(null)
          } catch (err) {
            window.alert(err instanceof Error ? err.message : 'Import failed.')
          }
        })
        .catch(() => window.alert('Could not read that file.'))
    },
    [controller],
  )

  // ----- Keyboard shortcuts --------------------------------------------------

  useEffect(() => {
    const isTypingTarget = (t: EventTarget | null): boolean => {
      const el = t as HTMLElement | null
      if (!el) return false
      return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable
    }
    const onKey = (e: KeyboardEvent): void => {
      if (isTypingTarget(e.target)) return
      const key = e.key
      const ctrl = e.ctrlKey || e.metaKey

      if (key === 'Escape') {
        if (helpOpen) setHelpOpen(false)
        else bridge.clearSelection()
        return
      }
      if (key === '?') {
        setHelpOpen((v) => !v)
        return
      }
      if (ctrl && (key === 'z' || key === 'Z')) {
        e.preventDefault()
        if (e.shiftKey) controller.redo()
        else controller.undo()
        return
      }
      if (ctrl && (key === 'y' || key === 'Y')) {
        e.preventDefault()
        controller.redo()
        return
      }
      if (ctrl && (key === '=' || key === '+')) {
        e.preventDefault()
        bridge.zoomByFactor(1.25)
        return
      }
      if (ctrl && key === '-') {
        e.preventDefault()
        bridge.zoomByFactor(0.8)
        return
      }
      if (ctrl && key === '0') {
        e.preventDefault()
        bridge.zoomTo(1)
        return
      }
      if (key === 'Delete' || key === 'Backspace') {
        if (bridge.deleteSelection()) e.preventDefault()
        return
      }
      if (key === 'PageUp' || key === 'PageDown') {
        const nb = controller.getNotebook()
        const i = nb.pages.findIndex((p) => p.id === pageIdRef.current)
        const next = key === 'PageUp' ? nb.pages[i - 1] : nb.pages[i + 1]
        if (next) {
          e.preventDefault()
          setPageId(next.id)
        }
        return
      }
      if (e.altKey && (key === 'n' || key === 'N')) {
        e.preventDefault()
        addPage()
        return
      }
      if (e.altKey || ctrl) return

      switch (key) {
        case 'p':
        case 'P':
          setTool('pen')
          break
        case 'h':
        case 'H':
          setTool('highlighter')
          break
        case 'e':
        case 'E':
          setTool('eraser')
          break
        case 'v':
        case 'V':
          setTool('select')
          break
        case 'l':
        case 'L':
          setTool('line')
          break
        case 'r':
        case 'R':
          setTool('rectangle')
          break
        case 'o':
        case 'O':
          setTool('ellipse')
          break
        case 'a':
        case 'A':
          setTool('arrow')
          break
        case 't':
        case 'T':
          setTool('text')
          break
        case 'n':
        case 'N':
          setNavigateMode((v) => !v)
          break
        case ' ':
          spaceRef.current = true
          e.preventDefault()
          break
        default:
          break
      }
    }
    const onKeyUp = (e: KeyboardEvent): void => {
      if (e.key === ' ') spaceRef.current = false
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [controller, bridge, helpOpen, addPage])

  // ----- Derived values ------------------------------------------------------

  const currentPage: PageDoc | undefined = notebook ? findPage(notebook, pageId) : undefined
  const undo = useCallback(() => controller.undo(), [controller])
  const redo = useCallback(() => controller.redo(), [controller])

  // Selection-derived info for the properties panel (recomputed when the
  // bridge notifies a change or the document changes).
  const selectionIds = bridge.getSelectionIds()
  const selectedObjects = useMemo(
    () => (currentPage ? currentPage.objects.filter((o) => selectionIds.includes(o.id)) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentPage, selectionVersion],
  )
  const selectedStrokesCount = selectedObjects.filter((o) => o.type === 'stroke').length
  const selectedText: TextObject | null =
    selectedObjects.length === 1 && selectedObjects[0]?.type === 'text'
      ? (selectedObjects[0] as TextObject)
      : null

  return (
    <div className="app" data-theme={settings.theme}>
      <TopBar
        notebookName={notebook?.name ?? 'Smart Whiteboard'}
        pageName={currentPage?.name ?? ''}
        zoomPercent={zoomPercent}
        saveState={saveState}
        theme={settings.theme}
        sidebarOpen={sidebarOpen}
        propertiesOpen={propertiesOpen}
        canUndo={history.canUndo}
        canRedo={history.canRedo}
        onUndo={undo}
        onRedo={redo}
        onExportPng={exportPng}
        onExportJson={exportJson}
        onImportJson={importJson}
        onToggleTheme={() => setSettings((s) => ({ ...s, theme: s.theme === 'light' ? 'dark' : 'light' }))}
        onToggleSidebar={() => setSidebarOpen((v) => !v)}
        onToggleProperties={() => setPropertiesOpen((v) => !v)}
        onShowHelp={() => setHelpOpen(true)}
      />

      {storageWarning && (
        <div className="banner" role="alert">
          <span>{storageWarning}</span>
          <button type="button" className="btn small" onClick={() => setStorageWarning(null)}>
            Dismiss
          </button>
        </div>
      )}

      {notice && (
        <div className="notice" role="status">
          {notice}
        </div>
      )}

      <div className="workspace">
        <Toolbar
          tool={tool}
          navigateMode={navigateMode}
          onToolChange={setTool}
          onToggleNavigate={() => setNavigateMode((v) => !v)}
        />
        {sidebarOpen && (
          <NotebookSidebar
            pages={notebook?.pages ?? []}
            currentPageId={pageId}
            onOpenPage={setPageId}
            onAddPage={addPage}
            onDuplicatePage={duplicatePage}
            onDeletePage={deletePage}
            onRenamePage={renamePage}
          />
        )}
        <main className="canvas-area">
          {notebook ? (
            <WhiteboardCanvas bridge={bridge} notebook={notebook} pageId={pageId} />
          ) : (
            <div className="canvas-loading">Loading your notebook…</div>
          )}
          {currentPage && currentPage.objects.length === 0 && (
            <div className="empty-hint" aria-hidden="true">
              Start writing…
            </div>
          )}
        </main>
        {propertiesOpen && currentPage && (
          <PropertiesPanel
            tool={tool}
            ink={ink}
            onInkChange={(patch) => setInk((prev) => ({ ...prev, ...patch }))}
            paper={{ background: currentPage.background, paperColor: currentPage.paperColor }}
            onPaperChange={(patch) => controller.dispatch(changePageStyleCommand(currentPage.id, patch))}
            settings={settings}
            onSettingsChange={(patch) => setSettings((s) => ({ ...s, ...patch }))}
            onClearPage={clearPage}
            selectedStrokesCount={selectedStrokesCount}
            selectedText={selectedText}
            onConvertSelectionToText={() => bridge.convertSelectionToText()}
            onTextChange={(id, patch) => controller.dispatch(updateTextCommand(currentPage.id, id, patch))}
          />
        )}
      </div>

      <HelpOverlay open={helpOpen} onClose={() => setHelpOpen(false)} />

      {!settings.hintDismissed && notebook && (
        <div className="hint-overlay" role="dialog" aria-label="Welcome">
          <p>
            <strong>Write with your stylus or finger.</strong>
          </p>
          <p className="hint-sub">
            Hold Space (or press N) to pan · pinch or Ctrl+wheel to zoom · press ? for help.
          </p>
          <button
            type="button"
            className="btn"
            onClick={() => setSettings((s) => ({ ...s, hintDismissed: true }))}
          >
            Got it
          </button>
        </div>
      )}
    </div>
  )
}
