import { useState } from 'react'
import type { JSX } from 'react'
import type { PageDoc } from '../documents/DocumentModel'

export interface NotebookSidebarProps {
  pages: PageDoc[]
  currentPageId: string
  onOpenPage: (pageId: string) => void
  onAddPage: () => void
  onDuplicatePage: (pageId: string) => void
  onDeletePage: (pageId: string) => void
  onRenamePage: (pageId: string, name: string) => void
}

/** Pages panel: create, rename (inline), duplicate and delete pages. */
export function NotebookSidebar(props: NotebookSidebarProps): JSX.Element {
  const {
    pages,
    currentPageId,
    onOpenPage,
    onAddPage,
    onDuplicatePage,
    onDeletePage,
    onRenamePage,
  } = props

  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')

  const commitRename = (): void => {
    if (renamingId) {
      const name = draftName.trim()
      if (name.length > 0) onRenamePage(renamingId, name)
    }
    setRenamingId(null)
  }

  return (
    <nav className="sidebar" aria-label="Pages">
      <div className="sidebar-head">
        <span className="sidebar-title">Pages</span>
        <button type="button" className="btn small" onClick={onAddPage} title="Add a page (Alt+N)">
          + New page
        </button>
      </div>
      <ul className="page-list">
        {pages.map((page, i) => (
          <li key={page.id}>
            {renamingId === page.id ? (
              <input
                className="page-rename"
                value={draftName}
                autoFocus
                aria-label="Page name"
                onChange={(e) => setDraftName(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename()
                  if (e.key === 'Escape') setRenamingId(null)
                }}
              />
            ) : (
              <div className={`page-row ${page.id === currentPageId ? 'current' : ''}`}>
                <button type="button" className="page-open" onClick={() => onOpenPage(page.id)}>
                  <span className="page-num">{i + 1}</span>
                  <span className="page-name">{page.name}</span>
                </button>
                <div className="page-actions">
                  <button
                    type="button"
                    className="icon-btn"
                    title="Rename page"
                    aria-label={`Rename page ${i + 1}`}
                    onClick={() => {
                      setRenamingId(page.id)
                      setDraftName(page.name)
                    }}
                  >
                    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                      <path d="M4 20l4-1L20 7l-3-3L5 16l-1 4z" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    title="Duplicate page"
                    aria-label={`Duplicate page ${i + 1}`}
                    onClick={() => onDuplicatePage(page.id)}
                  >
                    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                      <rect x="8" y="8" width="12" height="12" rx="2" />
                      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    className="icon-btn danger"
                    title={pages.length <= 1 ? 'The last page cannot be deleted' : 'Delete page (asks for confirmation)'}
                    aria-label={`Delete page ${i + 1}`}
                    disabled={pages.length <= 1}
                    onClick={() => onDeletePage(page.id)}
                  >
                    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                      <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
      <p className="sidebar-note">
        Pages autosave to this browser. Export a backup regularly — clearing site data removes local notes.
      </p>
    </nav>
  )
}
