import type { Board, Issue } from '@stormm/process-model'
import { useCallback, useEffect, useRef, useState } from 'react'
import { StorageError, storage } from './storage'

export type SaveState = 'saved' | 'failed'

export interface OpenProcess {
  id: string
  projectId: string | null
  board: Board
  issues: Issue[]
}

/**
 * Loads one process from this browser's storage and keeps it saved: every edit applies at
 * once and is written straight back as the whole YAML. If storage refuses the write (full,
 * blocked) the state is `failed` and the next edit retries. Undo/redo cover every edit (not
 * drag-to-reposition, which is a separate, personal view preference — see useDraggedPositions)
 * and reset when a different process opens.
 */
export function useProcess(processId: string | null, onError: (e: unknown) => void) {
  const [open, setOpen] = useState<OpenProcess | null>(null)
  const [loadError, setLoadError] = useState<StorageError | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('saved')

  const latest = useRef<{ id: string; board: Board } | null>(null)
  const errorRef = useRef(onError)
  useEffect(() => {
    errorRef.current = onError
  })

  const undoStack = useRef<Board[]>([])
  const redoStack = useRef<Board[]>([])
  const [history, setHistory] = useState({ canUndo: false, canRedo: false })
  const syncHistory = () => setHistory({ canUndo: undoStack.current.length > 0, canRedo: redoStack.current.length > 0 })

  const [openFor, setOpenFor] = useState<string | null>(null)
  if (openFor !== processId) {
    setOpenFor(processId)
    setOpen(null)
    setLoadError(null)
    setSaveState('saved')
    undoStack.current = []
    redoStack.current = []
    setHistory({ canUndo: false, canRedo: false })
    if (processId) {
      try {
        setOpen({ id: processId, ...storage.getProcess(processId) })
      } catch (e) {
        setLoadError(e instanceof StorageError ? e : new StorageError(String(e)))
      }
    }
  }

  // Edits build on the last edited board (several can land before a re-render), else on the loaded one.
  useEffect(() => {
    latest.current = null
  }, [processId])

  const current = () => latest.current ?? (open?.id === processId ? { id: open.id, board: open.board } : null)

  /** Writes a board to state and storage; doesn't touch the undo/redo stacks (callers do that). */
  const commit = (id: string, board: Board) => {
    latest.current = { id, board }
    setOpen((o) => (o?.id === id ? { ...o, board } : o))
    try {
      storage.saveProcess(board)
      setSaveState('saved')
    } catch (e) {
      setSaveState('failed')
      errorRef.current(e)
    }
  }

  /** Applies a pure edit to the open board, saves it, and pushes the prior board onto the undo stack. */
  const edit = useCallback(
    (change: (board: Board) => Board) => {
      const c = current()
      if (!c) return
      const board = change(c.board)
      if (board === c.board) return
      undoStack.current = [...undoStack.current, c.board]
      redoStack.current = []
      syncHistory()
      commit(c.id, board)
    },
    [processId, open],
  )

  const undo = useCallback(() => {
    const c = current()
    if (!c) return
    const prev = undoStack.current.at(-1)
    if (prev === undefined) return
    undoStack.current = undoStack.current.slice(0, -1)
    redoStack.current = [...redoStack.current, c.board]
    syncHistory()
    commit(c.id, prev)
  }, [processId, open])

  const redo = useCallback(() => {
    const c = current()
    if (!c) return
    const next = redoStack.current.at(-1)
    if (next === undefined) return
    redoStack.current = redoStack.current.slice(0, -1)
    undoStack.current = [...undoStack.current, c.board]
    syncHistory()
    commit(c.id, next)
  }, [processId, open])

  const setProjectId = useCallback((projectId: string | null) => setOpen((o) => (o ? { ...o, projectId } : o)), [])

  return { open, loadError, saveState, edit, undo, redo, canUndo: history.canUndo, canRedo: history.canRedo, setProjectId }
}
