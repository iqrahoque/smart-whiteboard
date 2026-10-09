/**
 * DocumentController — owns the current NotebookDoc plus the undo/redo stacks.
 *
 * React components never hold page objects; they subscribe for coarse change
 * notifications (page list, history depth) and read through the controller.
 * High-frequency input never passes through here (see canvas/InputController).
 */

import type { NotebookDoc } from './DocumentModel'
import type { DocCommand } from './Commands'

export const HISTORY_LIMIT = 200

export interface HistoryState {
  canUndo: boolean
  canRedo: boolean
  undoCount: number
  redoCount: number
}

export class DocumentController {
  private notebook: NotebookDoc
  private undoStack: DocCommand[] = []
  private redoStack: DocCommand[] = []

  private readonly listeners = new Set<() => void>()

  constructor(notebook: NotebookDoc) {
    this.notebook = notebook
  }

  getNotebook(): NotebookDoc {
    return this.notebook
  }

  getHistory(): HistoryState {
    return {
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      undoCount: this.undoStack.length,
      redoCount: this.redoStack.length,
    }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private emit(): void {
    for (const l of this.listeners) l()
  }

  /** Apply a completed, reversible command. */
  dispatch(command: DocCommand): void {
    this.notebook = command.apply(this.notebook)
    this.undoStack.push(command)
    if (this.undoStack.length > HISTORY_LIMIT) {
      this.undoStack.splice(0, this.undoStack.length - HISTORY_LIMIT)
    }
    this.redoStack = []
    this.emit()
  }

  undo(): boolean {
    const command = this.undoStack.pop()
    if (!command) return false
    this.notebook = command.revert(this.notebook)
    this.redoStack.push(command)
    this.emit()
    return true
  }

  redo(): boolean {
    const command = this.redoStack.pop()
    if (!command) return false
    this.notebook = command.apply(this.notebook)
    this.undoStack.push(command)
    this.emit()
    return true
  }

  /**
   * Replace the whole document (load / import). History is cleared: undoing
   * across a document replacement is not meaningful and would risk restoring
   * objects into a foreign document.
   */
  replaceDocument(notebook: NotebookDoc): void {
    this.notebook = notebook
    this.undoStack = []
    this.redoStack = []
    this.emit()
  }
}
