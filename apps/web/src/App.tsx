import {
  addBlock as addBlockTo,
  connect as connectBlocks,
  disconnect,
  extractBlocks,
  findBlock,
  layoutBoard,
  parseBoard,
  pasteBlocks,
  removeBlock,
  renameBoard,
  retitleNewBlock,
  toYaml,
  updateBlock,
  validate,
  type BlockPatch,
  type Board,
  type Issue,
  type Point,
} from '@stormm/process-model'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, type CanvasBlock, type CanvasConnection, type Viewport } from './canvas/Canvas'
import { selectBlocks, selectedBlockIds, type Selection } from './canvas/selection'
import { LAYOUT, PORT_Y, snap } from './canvas/geometry'
import { Inspector } from './canvas/Inspector'
import { YamlPanel } from './canvas/YamlPanel'
import { Button, Composer, EditableText, Header, IconButton, Sidebar, blockKindLabel, type BlockKind } from './components'
import { Guide } from './Guide'
import { LiveControl } from './live/LiveControl'
import { useLiveSession } from './live/useLiveSession'
import { ProcessNav } from './ProcessNav'
import { storage, type ProcessSummary, type Project } from './storage'
import { useDraggedPositions } from './useDraggedPositions'
import { useProcess, type SaveState } from './useProcess'

const INITIAL_VIEWPORT: Viewport = { x: 64, y: 88, zoom: 1 }

const SIDEBAR_KEY = 'stormm.sidebarHidden'
const readSidebarHidden = () => {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === 'true'
  } catch {
    return false
  }
}

// Storage can be unavailable (blocked site data); the app then starts empty.
const readProcesses = () => {
  try {
    return storage.listProcesses()
  } catch {
    return []
  }
}
const readProjects = () => {
  try {
    return storage.listProjects()
  } catch {
    return []
  }
}

const processIdFromHash = () => window.location.hash.match(/^#\/p\/([^/]+)/)?.[1] ?? null
const isGuideHash = () => window.location.hash === '#/guide'

const NO_POSITIONS: Record<string, Point> = {}

const SAVE_LABEL: Record<SaveState, string> = {
  saved: 'Saved in this browser',
  failed: 'Not saved',
}

function App() {
  const [processes, setProcesses] = useState<ProcessSummary[] | null>(readProcesses)
  const [projects, setProjects] = useState<Project[]>(readProjects)
  const [sidebarHidden, setSidebarHidden] = useState(readSidebarHidden)
  const [processId, setProcessId] = useState(processIdFromHash)
  const [guideOpen, setGuideOpen] = useState(isGuideHash)
  const [selection, setSelection] = useState<Selection>(null)
  const [yamlOpen, setYamlOpen] = useState(false)
  const [viewport, setViewport] = useState(INITIAL_VIEWPORT)
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null)
  const [renaming, setRenaming] = useState(false)
  /**
   * Blocks added in this session. Their ids still follow their titles; once the page is
   * reloaded their ids are frozen.
   */
  const fresh = useRef({ processId, blocks: new Set<string>() })
  const freshIds = () => {
    if (fresh.current.processId !== processId) fresh.current = { processId, blocks: new Set() }
    return fresh.current.blocks
  }

  const fail = useCallback((e: unknown) => setNotice({ text: e instanceof Error ? e.message : String(e), error: true }), [])
  const say = useCallback((text: string, error?: boolean) => setNotice({ text, error }), [])

  const {
    open,
    loadError,
    saveState,
    edit: editOwn,
    undo: undoOwn,
    redo: redoOwn,
    canUndo: canUndoOwn,
    canRedo: canRedoOwn,
    setProjectId,
    replace,
  } = useProcess(processId, fail)
  const ownBoard: Board | null = open?.id === processId ? open.board : null

  /** Keeps a board from a session that's over, under a free id so nothing here is overwritten. */
  const keepCopy = useCallback(
    (board: Board, asked: string) => {
      if (!window.confirm(asked)) return
      try {
        const { imported } = storage.importProcesses([{ name: `${board.id}.yaml`, text: toYaml(board) }], null)
        setProcesses(storage.listProcesses())
        if (imported[0]) window.location.hash = `#/p/${imported[0].id}`
      } catch (e) {
        fail(e)
      }
    },
    [fail],
  )

  const onHostLeft = useCallback(
    (board: Board | null) => {
      if (board) keepCopy(board, `The host ended the live session.\n\nKeep a copy of “${board.name}” in this browser?`)
      else say('The host ended the live session')
    },
    [keepCopy, say],
  )

  // ── Live session ─────────────────────────────────────────────────────────
  // In a session the canvas shows one board that everyone in it edits — it replaces whatever
  // process this browser has open, which stays open underneath and untouched. Edits, undo and
  // the block arrangement all go through the session; the view (pan, zoom, selection) stays
  // each person's own, since you can't edit a corner of the board you can't look at.
  //
  // Only the host keeps the board: it's their process. Everyone else is offered a copy of it
  // when the session ends.
  const live = useLiveSession(say, onHostLeft)
  const inSession = live.session !== null
  const guesting = live.session?.role === 'guest'
  const hosting = live.session?.role === 'host'
  const hostName = live.session?.people.find((p) => p.role === 'host')?.name

  const board: Board | null = inSession ? live.board : ownBoard
  const edit = inSession ? live.edit : editOwn
  const undo = inSession ? live.undo : undoOwn
  const redo = inSession ? live.redo : redoOwn
  const canUndo = inSession ? live.canUndo : canUndoOwn
  const canRedo = inSession ? live.canRedo : canRedoOwn

  useEffect(() => {
    const onHash = () => {
      setProcessId(processIdFromHash())
      setGuideOpen(isGuideHash())
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const toggleSidebar = (hidden: boolean) => {
    setSidebarHidden(hidden)
    try {
      localStorage.setItem(SIDEBAR_KEY, String(hidden))
    } catch {
      // Not persisted — stays for this page load.
    }
  }

  // With no process in the URL, open the first one — unless the guide is what was asked for.
  useEffect(() => {
    if (!processId && !guideOpen && processes?.length) window.location.hash = `#/p/${processes[0].id}`
  }, [processId, guideOpen, processes])

  // Switching process starts from a clean view.
  const [viewFor, setViewFor] = useState(processId)
  if (viewFor !== processId) {
    setViewFor(processId)
    setSelection(null)
    setViewport(INITIAL_VIEWPORT)
  }

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), notice.error ? 5000 : 2000)
    return () => clearTimeout(t)
  }, [notice])

  // ── Derived view ─────────────────────────────────────────────────────────

  const layout = useMemo(() => (board ? layoutBoard(board, LAYOUT) : null), [board])
  // Always this browser's own process: in a session the arrangement is shared, and must not be
  // pruned against, or written for, the blocks of a board that isn't this browser's.
  const ownIds = useMemo(() => (ownBoard ? ownBoard.blocks.map((b) => b.id) : null), [ownBoard])
  const dragged = useDraggedPositions(processId, ownIds)
  /** Where the blocks sit. In a session that's shared too — otherwise nobody can point at one. */
  const positions = inSession ? (live.positions ?? NO_POSITIONS) : dragged.positions
  const moveBlock = inSession ? live.move : dragged.move
  const renamePosition = inSession ? live.renamePosition : dragged.rename
  const resetLayout = inSession ? live.resetLayout : dragged.reset
  const issues = useMemo(() => (board ? validate(board) : []), [board])
  const yaml = useMemo(() => (board ? toYaml(board) : ''), [board])

  // The open process's name is live (edited in the header) before the list is refetched.
  // Memoized so panning/dragging on the canvas (which re-renders App on every settle/frame)
  // doesn't force the whole sidebar to re-sort and re-render along with it.
  const sidebarProcesses = useMemo(
    () => processes?.map((p) => (p.id === ownBoard?.id ? { ...p, name: ownBoard.name } : p)) ?? null,
    [processes, ownBoard?.id, ownBoard?.name],
  )

  const canvasBlocks: CanvasBlock[] = useMemo(() => {
    if (!board || !layout) return []
    return board.blocks.map((b) => ({
      id: b.id,
      kind: b.kind,
      title: b.title,
      actor: b.actor,
      hotspots: b.hotspots.length,
      invariants: b.invariants.length,
      ...(positions[b.id] ?? layout.positions.get(b.id) ?? { x: 0, y: 0 }),
    }))
  }, [board, layout, positions])

  const canvasConnections: CanvasConnection[] = useMemo(
    () => (board ? board.connections.map((c) => ({ id: `${c.from}->${c.to}`, from: c.from, to: c.to })) : []),
    [board],
  )

  const selectedBlock = board && selection?.type === 'block' ? findBlock(board, selection.id) : undefined

  // ── Hosting ──────────────────────────────────────────────────────────────
  // The shared board is the host's process, so everyone's edits land in their browser as they
  // arrive — that's the only copy being kept while the session runs.
  const { leave } = live
  const draggedReplace = dragged.replace
  useEffect(() => {
    if (!hosting || !live.board) return
    replace(live.board)
    draggedReplace(live.positions ?? NO_POSITIONS)
  }, [hosting, live.board, live.positions, replace, draggedReplace])

  /** Leaving offers the board to whoever doesn't already have it — the host's is already saved. */
  const leaveLive = () => {
    const shared = guesting ? live.board : null
    leave()
    if (shared) keepCopy(shared, `Keep a copy of “${shared.name}” in this browser?`)
    else say(hosting ? 'Live session ended' : 'Left the live session')
  }

  // Opening one of your own processes leaves the session — the canvas can only show one board.
  // Read through a ref so re-renders can't turn this into "leave immediately".
  const sessionRef = useRef(inSession)
  const leaveRef = useRef<() => void>(() => {})
  useEffect(() => {
    sessionRef.current = inSession
    leaveRef.current = leaveLive
  })
  useEffect(() => {
    if (sessionRef.current) leaveRef.current()
  }, [processId])

  // ── Edits ────────────────────────────────────────────────────────────────

  const patchBlock = (id: string, patch: BlockPatch) => {
    let target = id
    if (patch.title !== undefined && freshIds().has(id)) {
      const title = patch.title
      edit((b) => {
        const r = retitleNewBlock(b, id, title)
        target = r.blockId
        return r.board
      })
      if (target !== id) {
        freshIds().delete(id)
        freshIds().add(target)
        renamePosition(id, target)
        setSelection((s) => (s?.type === 'block' && s.id === id ? { type: 'block', id: target } : s))
      }
      const { title: _, ...rest } = patch
      patch = rest
    }
    if (Object.keys(patch).length) edit((b) => updateBlock(b, target, patch))
  }

  const deleteBlock = (id: string) => {
    setSelection(null)
    edit((b) => removeBlock(b, id))
  }

  const deleteBlocks = (ids: string[]) => {
    setSelection(null)
    edit((b) => ids.reduce((acc, id) => removeBlock(acc, id), b))
  }

  // ── Copy and paste ───────────────────────────────────────────────────────
  // A copy is the selected blocks and the connections between them, as storm YAML, so it pastes
  // into any process (or anywhere text goes). Positions aren't part of the YAML; the last copy
  // remembers them so pasting it back keeps the blocks' arrangement, a step further each time.
  const lastCopy = useRef<{ text: string; positions: Map<string, Point>; pastes: number } | null>(null)

  const copyBlocks = (ids: string[]) => {
    if (!board || !ids.length) return
    const text = toYaml(extractBlocks(board, ids))
    const positions = new Map(canvasBlocks.filter((b) => ids.includes(b.id)).map((b) => [b.id, { x: b.x, y: b.y }]))
    lastCopy.current = { text, positions, pastes: 0 }
    navigator.clipboard.writeText(text).then(() => setNotice({ text: `Copied ${ids.length} block${ids.length > 1 ? 's' : ''}` }), fail)
  }

  /** Pastes storm YAML as new blocks; returns false when the text isn't a process with blocks. */
  const pasteText = (text: string) => {
    if (!board) return false
    const { board: fragment } = parseBoard(text)
    if (!fragment?.blocks.length) return false
    let ids = new Map<string, string>()
    edit((b) => {
      const r = pasteBlocks(b, fragment)
      ids = r.ids
      return r.board
    })
    const copy = lastCopy.current
    if (copy?.text === text) {
      copy.pastes += 1
      const step = 40 * copy.pastes
      for (const [from, to] of ids) {
        const p = copy.positions.get(from)
        if (p) moveBlock(to, { x: snap(p.x + step), y: snap(p.y + step) })
      }
    }
    setSelection(selectBlocks([...ids.values()]))
    setNotice({ text: `Pasted ${ids.size} block${ids.size > 1 ? 's' : ''}` })
    return true
  }

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"]')) return
      if (pasteText(e.clipboardData?.getData('text/plain') ?? '')) e.preventDefault()
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  })

  const deleteConnection = (key: string) => {
    setSelection(null)
    const [from, to] = key.split('->')
    edit((b) => disconnect(b, from, to))
  }

  const connect = (from: string, to: string) => edit((b) => connectBlocks(b, from, to))

  /** New blocks continue the process: connected from the selected block. */
  const addBlock = (kind: BlockKind) => {
    if (!board) return
    const from = selectedBlock?.id
    let created = ''
    edit((b) => {
      const r = addBlockTo(b, { kind, title: `New ${blockKindLabel[kind].toLowerCase()}` })
      created = r.blockId
      return from ? connectBlocks(r.board, from, r.blockId) : r.board
    })
    if (!created) return
    freshIds().add(created)
    setSelection({ type: 'block', id: created })
  }

  /** A wire dropped on empty canvas: a new block of that kind, connected from the source, where the wire ended. */
  const addConnectedBlock = (from: string, kind: BlockKind, at: { x: number; y: number }) => {
    let created = ''
    edit((b) => {
      const r = addBlockTo(b, { kind, title: `New ${blockKindLabel[kind].toLowerCase()}` })
      created = r.blockId
      return connectBlocks(r.board, from, r.blockId)
    })
    if (!created) return
    freshIds().add(created)
    // The wire's end is the new block's left port.
    moveBlock(created, { x: snap(at.x), y: snap(at.y - PORT_Y) })
    setSelection({ type: 'block', id: created })
  }

  /** Right-click → Add block: an unconnected block of that kind where the canvas was clicked. */
  const addBlockAt = (kind: BlockKind, at: { x: number; y: number }) => {
    let created = ''
    edit((b) => {
      const r = addBlockTo(b, { kind, title: `New ${blockKindLabel[kind].toLowerCase()}` })
      created = r.blockId
      return r.board
    })
    if (!created) return
    freshIds().add(created)
    moveBlock(created, { x: snap(at.x), y: snap(at.y) })
    setSelection({ type: 'block', id: created })
  }

  // ── Processes and projects ───────────────────────────────────────────────

  const createProcess = (projectId: string | null = null) => {
    try {
      const created = storage.createProcess('Untitled process', projectId)
      setProcesses((ps) => [...(ps ?? []), { id: created.board.id, name: created.board.name, projectId: created.projectId }])
      setRenaming(true)
      window.location.hash = `#/p/${created.board.id}`
    } catch (e) {
      fail(e)
    }
  }

  const renameProcess = (name: string) => {
    if (!board) return
    setRenaming(false)
    // The sidebar lists this browser's own processes; a guest renaming the shared board isn't one.
    if (!guesting) setProcesses((ps) => ps?.map((p) => (p.id === ownBoard?.id ? { ...p, name } : p)) ?? ps)
    edit((b) => renameBoard(b, name))
  }

  /** Renames any process from the sidebar; the open one goes through the editor so its undo and save state stay in step. */
  const renameProcessById = (id: string, name: string) => {
    if (id === ownBoard?.id) return renameProcess(name)
    try {
      storage.renameProcess(id, name)
      setProcesses((ps) => ps?.map((p) => (p.id === id ? { ...p, name } : p)) ?? ps)
    } catch (e) {
      fail(e)
    }
  }

  const moveProcess = (id: string, projectId: string | null) => {
    try {
      storage.moveProcess(id, projectId)
      setProcesses((ps) => ps?.map((p) => (p.id === id ? { ...p, projectId } : p)) ?? ps)
      if (id === processId) setProjectId(projectId)
    } catch (e) {
      fail(e)
    }
  }

  const createProject = async () => {
    try {
      const project = storage.createProject('Untitled project')
      setProjects((ps) => [...ps, project])
      return project
    } catch (e) {
      fail(e)
    }
  }

  const renameProject = (id: string, name: string) => {
    try {
      storage.renameProject(id, name)
      setProjects((ps) => ps.map((p) => (p.id === id ? { ...p, name } : p)))
    } catch (e) {
      fail(e)
    }
  }

  /** Its processes are kept and move to "No project". */
  const deleteProject = (project: Project) => {
    if (!window.confirm(`Delete the “${project.name}” project? Its processes move to No project.`)) return
    try {
      storage.deleteProject(project.id)
      setProjects((ps) => ps.filter((p) => p.id !== project.id))
      setProcesses((ps) => ps?.map((p) => (p.projectId === project.id ? { ...p, projectId: null } : p)) ?? ps)
      if (open?.projectId === project.id) setProjectId(null)
    } catch (e) {
      fail(e)
    }
  }

  const deleteProcess = () => {
    if (!ownBoard || !window.confirm(`Delete “${ownBoard.name}”? It is only stored in this browser.`)) return
    try {
      storage.deleteProcess(ownBoard.id)
      const rest = (processes ?? []).filter((p) => p.id !== ownBoard.id)
      setProcesses(rest)
      window.location.hash = rest.length ? `#/p/${rest[0].id}` : ''
    } catch (e) {
      fail(e)
    }
  }

  /**
   * Imports storm YAML files. Loose files go to No project. A folder's files go into the project
   * named like the folder (created if needed). Repositories keep their storms in `.stormm/`: when
   * the folder has one, only the YAML inside it is imported; when the folder is `.stormm` itself,
   * the project name is asked for. Other files are ignored.
   */
  const importFiles = async (files: File[], folder: string | null) => {
    let yamls = files.filter((f) => /\.ya?ml$/i.test(f.name))
    const inStormm = yamls.filter((f) => f.webkitRelativePath.split('/').slice(0, -1).includes('.stormm'))
    if (folder && inStormm.length) yamls = inStormm
    if (!yamls.length) {
      window.alert(folder ? `No .yaml or .yml files in “${folder}”.` : 'Pick .yaml or .yml files.')
      return
    }
    let projectName = folder
    if (folder === '.stormm') {
      const name = window.prompt('Import into which project? Leave empty for No project.', '')
      if (name === null) return
      projectName = name.trim() || null
    }
    try {
      let projectId: string | null = null
      if (projectName) {
        const existing = storage.listProjects().find((p) => p.name.toLowerCase() === projectName.toLowerCase())
        projectId = existing?.id ?? storage.createProject(projectName).id
      }
      const texts = await Promise.all(yamls.map(async (f) => ({ name: f.webkitRelativePath || f.name, text: await f.text() })))
      const { imported, skipped } = storage.importProcesses(texts, projectId)
      setProcesses(storage.listProcesses())
      setProjects(storage.listProjects())

      const skippedText = skipped.map((s) => `${s.file}: ${s.reason}`).join('\n')
      if (!imported.length) {
        window.alert(`Nothing imported.\n\n${skippedText}`)
        return
      }
      const renamed = imported.filter((p) => p.renamedFrom)
      const parts = [`Imported ${imported.length} process${imported.length > 1 ? 'es' : ''}`]
      if (renamed.length) parts.push(`${renamed.length} got a new id (already taken)`)
      if (skipped.length) parts.push(`skipped ${skipped.length}`)
      window.location.hash = `#/p/${imported[0].id}`
      setNotice({ text: parts.join(' · '), error: skipped.length > 0 })
      if (skipped.length) window.alert(`Skipped:\n\n${skippedText}`)
    } catch (e) {
      fail(e)
    }
  }

  const downloadYaml = () => {
    if (!board) return
    const url = URL.createObjectURL(new Blob([yaml], { type: 'application/yaml' }))
    const a = Object.assign(document.createElement('a'), { href: url, download: `${board.id}.yaml` })
    a.click()
    URL.revokeObjectURL(url)
  }

  const copyYaml = () => navigator.clipboard.writeText(yaml).then(() => setNotice({ text: 'YAML copied' }), fail)

  /** Parses hand-edited (or pasted) YAML and, if it's a valid process, replaces the board with it — the id stays frozen to this process. */
  const applyYaml = (text: string): { applied: boolean; issues: Issue[] } => {
    if (!board) return { applied: false, issues: [] }
    const { board: parsed, issues: parseIssues } = parseBoard(text)
    if (!parsed) return { applied: false, issues: parseIssues }
    const next = { ...parsed, id: board.id }
    edit(() => next)
    return { applied: true, issues: [...parseIssues, ...validate(next)] }
  }

  // Delete/Backspace removes the selection, Escape clears it, Cmd/Ctrl+C copies the selected
  // blocks, Cmd/Ctrl+A selects them all, and Cmd/Ctrl+Z / Shift+Z undoes/redoes the last edit.
  // Ignored while typing (a text field's own undo takes over there).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (el.closest('input, textarea, select, [contenteditable="true"]')) return
      const ids = selectedBlockIds(selection)
      const mod = e.metaKey || e.ctrlKey
      if (e.key === 'Escape') setSelection(null)
      if ((e.key === 'Delete' || e.key === 'Backspace') && selection) {
        e.preventDefault()
        if (ids.length) deleteBlocks(ids)
        else if (selection.type === 'connection') deleteConnection(selection.id)
      }
      // Text selected on the page (e.g. in the YAML panel) copies as usual.
      if (mod && e.key.toLowerCase() === 'c' && ids.length && !window.getSelection()?.toString()) {
        e.preventDefault()
        copyBlocks(ids)
      }
      if (mod && e.key.toLowerCase() === 'a' && board && (el === document.body || el.closest('[aria-label="Process canvas"]'))) {
        e.preventDefault()
        setSelection(selectBlocks(board.blocks.map((b) => b.id)))
      }
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        redo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const errorCount = issues.filter((i) => i.level === 'error').length
  const hasDrags = Object.keys(positions).length > 0


  return (
    <div className="flex h-screen overflow-hidden">
      {!sidebarHidden && (
        <Sidebar userInitial="F" userName="Fang" onCollapse={() => toggleSidebar(true)} onGuide={() => (window.location.hash = '#/guide')} guideActive={guideOpen}>
          <ProcessNav
            processes={sidebarProcesses}
            projects={projects}
            activeId={processId}
            onNewProcess={createProcess}
            onImport={importFiles}
            onRenameProcess={renameProcessById}
            onMoveProcess={moveProcess}
            onNewProject={createProject}
            onRenameProject={renameProject}
            onDeleteProject={deleteProject}
          />
        </Sidebar>
      )}

      <main className="flex min-w-0 flex-grow flex-col">
        <Header
          leading={
            sidebarHidden && (
              <IconButton size="md" aria-label="Show sidebar" onClick={() => toggleSidebar(false)} icon={<SidebarIcon />} />
            )
          }
          title={
            guideOpen ? (
              'Guide'
            ) : board ? (
              <EditableText
                key={board.id}
                aria-label="Process name"
                value={board.name}
                required
                autoFocus={renaming}
                onCommit={renameProcess}
                onBlur={() => setRenaming(false)}
                className="-mx-1 w-96 max-w-full px-1"
              />
            ) : guesting ? (
              'Live session'
            ) : (
              'Stormm'
            )
          }
          actions={
            // The Live control stays reachable with nothing open, so someone can join a session
            // before they have a process of their own.
            !guideOpen &&
            (board || live.configured) && (
              <>
                {notice ? (
                  <span role="status" className={`mr-step-sm text-meta ${notice.error ? 'text-hotspot-text' : 'text-text-muted'}`}>
                    {notice.text}
                  </span>
                ) : (
                  (guesting || ownBoard) && (
                    <span role="status" className={`mr-step-sm text-meta ${!guesting && saveState === 'failed' ? 'text-hotspot-text' : 'text-text-muted'}`}>
                      {guesting ? 'Live · not saved here' : SAVE_LABEL[saveState]}
                    </span>
                  )
                )}
                {board && (
                  <>
                    <IconButton size="md" aria-label="Undo" disabled={!canUndo} onClick={undo} icon={<UndoIcon />} className="disabled:cursor-not-allowed disabled:opacity-40" />
                    <IconButton size="md" aria-label="Redo" disabled={!canRedo} onClick={redo} icon={<RedoIcon />} className="disabled:cursor-not-allowed disabled:opacity-40" />
                  </>
                )}
                {!guesting && ownBoard && (
                  <Button variant="secondary" onClick={deleteProcess}>
                    Delete
                  </Button>
                )}
                {live.configured && (
                  <LiveControl
                    session={live.session}
                    canStart={Boolean(ownBoard)}
                    onStart={(name) => ownBoard && live.start(name, ownBoard, dragged.positions)}
                    onJoin={live.join}
                    onLeave={leaveLive}
                  />
                )}
                {board && (
                  <Button
                    variant="primary"
                    aria-pressed={yamlOpen}
                    onClick={() => setYamlOpen((o) => !o)}
                  >
                    YAML
                    {errorCount > 0 && <span className="rounded-full bg-hotspot-surface px-1.5 text-chip text-hotspot-text">{errorCount}</span>}
                  </Button>
                )}
              </>
            )
          }
        />

        <div className="relative flex min-h-0 flex-grow">
          {guideOpen ? (
            <Guide />
          ) : board && layout ? (
            <Canvas
              blocks={canvasBlocks}
              connections={canvasConnections}
              selection={selection}
              viewport={viewport}
              onViewportChange={setViewport}
              onSelect={setSelection}
              onMoveBlock={(id, x, y) => moveBlock(id, { x, y })}
              onConnect={connect}
              onRenameBlock={(id, title) => patchBlock(id, { title })}
              onConnectToNew={addConnectedBlock}
              onAddBlockAt={addBlockAt}
              onDeleteBlock={deleteBlock}
              onDeleteConnection={deleteConnection}
            >
              {hasDrags && (
                <div className="absolute top-step-2xl right-step-2xl">
                  <Button variant="secondary" onClick={resetLayout}>
                    Reset layout
                  </Button>
                </div>
              )}
              {/* The strip spans the canvas width; only the composer itself takes clicks. */}
              <div className="pointer-events-none absolute right-0 bottom-step-3xl left-0 flex justify-center px-step-3xl">
                <div className="pointer-events-auto w-full max-w-2xl">
                  <Composer
                    placeholder="Add a block with +, drag the right port to connect"
                    onAddBlock={addBlock}
                  />
                </div>
              </div>
            </Canvas>
          ) : (
            <section aria-label="Process canvas" className="flex flex-grow flex-col items-center justify-center gap-step-lg bg-surface text-body text-text-muted">
              {guesting ? (
                live.session?.status === 'error' ? (
                  <span className="text-hotspot-text">Couldn’t reach that session. Check the key, or your connection.</span>
                ) : (
                  `Waiting for ${hostName ?? 'the host'}…`
                )
              ) : loadError?.issues ? (
                <div className="max-w-xl">
                  <div className="mb-step-md text-hotspot-text">{loadError.message}</div>
                  <ul className="m-0 flex flex-col gap-step-xs pl-step-xl text-meta">
                    {loadError.issues.map((i, n) => (
                      <li key={n}>
                        {i.path && <code className="font-mono">{i.path}: </code>}
                        {i.message}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : loadError ? (
                <span className="text-hotspot-text">{loadError.message}</span>
              ) : processes === null || processes.length > 0 ? (
                'Loading…'
              ) : (
                'No processes yet.'
              )}
              {!guesting && processes?.length === 0 && (
                <Button variant="primary" onClick={() => createProcess()}>
                  New process
                </Button>
              )}
            </section>
          )}

          {board && yamlOpen ? (
            <YamlPanel
              path={`${board.id}.yaml`}
              yaml={yaml}
              issues={issues}
              onCopy={copyYaml}
              onDownload={downloadYaml}
              onApply={applyYaml}
              onClose={() => setYamlOpen(false)}
            />
          ) : (
            board &&
            selectedBlock && (
              <Inspector
                key={selectedBlock.id}
                block={selectedBlock}
                board={board}
                onChange={(patch) => patchBlock(selectedBlock.id, patch)}
                onDelete={() => deleteBlock(selectedBlock.id)}
                onSelectBlock={(id) => setSelection({ type: 'block', id })}
                onClose={() => setSelection(null)}
              />
            )
          )}
        </div>
      </main>
    </div>
  )
}

function SidebarIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
    </svg>
  )
}

function UndoIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 7 3 11l5 4" />
      <path d="M3 11h12a5 5 0 0 1 0 10h-3" />
    </svg>
  )
}

function RedoIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m16 7 5 4-5 4" />
      <path d="M21 11H9a5 5 0 0 0 0 10h3" />
    </svg>
  )
}

export default App
