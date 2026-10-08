import {
  markBoard,
  markEdit,
  mergeBoards,
  type Board,
  type BoardMarks,
  type Point,
  type Stamp,
} from '@stormm/process-model'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { useCallback, useEffect, useRef, useState } from 'react'
import { liveConfigured, loadClient, loadedClient } from './client'
import { newSessionKey } from './sessionKey'

export type LiveRole = 'host' | 'guest'
export type LiveStatus = 'connecting' | 'live' | 'error'

export interface LivePerson {
  id: string
  name: string
  role: LiveRole
}

/** Where blocks have been dragged to, and when each was last moved. */
interface Layout {
  positions: Record<string, Point>
  marks: Record<string, Stamp>
}

/**
 * The board everyone in the session is working on, and what this browser knows about when each
 * part of it last changed. Dragged positions ride along: they are not in the YAML, but a shared
 * board that everyone arranges differently is a board nobody can talk about.
 */
export interface Shared {
  board: Board
  marks: BoardMarks
  layout: Layout
}

export interface LiveSession {
  role: LiveRole
  /** What the host shares and a guest types in; also the channel's topic. */
  key: string
  name: string
  status: LiveStatus
  /** Everyone in the session, this browser included. */
  people: LivePerson[]
}

const topic = (key: string) => `stormm:live:${key}`

/**
 * Edits are coalesced into at most one message per tick, so a burst (or a drag) sends the
 * settled state once instead of every step towards it. Keeps a session well inside Realtime's
 * default message rate too.
 */
const PUBLISH_MS = 100

interface Message {
  from: string
  board: Board
  marks: BoardMarks
  layout: Layout
}

/** Per-block latest-wins, the same rule the board itself merges by. */
function mergeLayout(mine: Layout, theirs: Layout): Layout {
  const merged: Layout = { positions: { ...mine.positions }, marks: { ...mine.marks } }
  for (const [id, stamp] of Object.entries(theirs.marks)) {
    const held = merged.marks[id]
    const later = !held || stamp[0] > held[0] || (stamp[0] === held[0] && stamp[1] > held[1])
    if (!later) continue
    merged.marks[id] = stamp
    const point = theirs.positions[id]
    if (point) merged.positions[id] = point
    else delete merged.positions[id]
  }
  return merged
}

const topCounter = (shared: Shared): number => {
  let top = shared.marks.name[0]
  for (const mark of [...Object.values(shared.marks.blocks), ...Object.values(shared.marks.connections)]) {
    top = Math.max(top, mark.at[0], mark.born[0])
  }
  for (const stamp of Object.values(shared.layout.marks)) top = Math.max(top, stamp[0])
  return top
}

/**
 * One live session — a Supabase Realtime channel named after the session key, carrying one
 * board that everyone in it edits.
 *
 * Nobody is in charge of the board: each browser applies its own edit at once and sends its
 * whole state, and the merge decides part by part who wrote last, the same way everywhere (see
 * mergeBoards). Two people editing different blocks keep both edits; two people editing the
 * same one settle on the later. The host is only the person whose process it is — they are the
 * one who persists it, answers a late joiner's snapshot, and whose leaving ends the session,
 * since nothing is stored server-side.
 *
 * Anyone holding the key can edit, so the key is the whole of the security model.
 */
export function useLiveSession(
  notify: (text: string, error?: boolean) => void,
  /** The host closed their tab: the session is over, and the board is the caller's to offer. */
  onHostLeft: (board: Board | null) => void,
) {
  const [session, setSession] = useState<LiveSession | null>(null)
  const [shared, setShared] = useState<Shared | null>(null)

  const channelRef = useRef<RealtimeChannel | null>(null)
  /** This browser's id in the session: its presence key, and the `from` on everything it sends. */
  const me = useRef('')
  const role = useRef<LiveRole | null>(null)
  /**
   * The shared state as of this instant. Several edits can land before React re-renders, and
   * each has to build on the last, so the ref — not the state — is what an edit reads.
   */
  const held = useRef<Shared | null>(null)
  /** Lamport clock: one ahead of the highest counter this browser has seen from anyone. */
  const clock = useRef(0)
  const dirty = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  /** Board snapshots, newest last. Dragging isn't in here — it never was (see useDraggedPositions). */
  const undoStack = useRef<Shared[]>([])
  const redoStack = useRef<Shared[]>([])
  const [history, setHistory] = useState({ canUndo: false, canRedo: false })
  /** Guest: whether presence has ever named a host, so its absence means they left. */
  const hadHost = useRef(false)
  /** The session being opened, so one abandoned while the client loads can't subscribe late. */
  const attempt = useRef<object | null>(null)

  const notifyRef = useRef(notify)
  const endedRef = useRef(onHostLeft)
  useEffect(() => {
    notifyRef.current = notify
    endedRef.current = onHostLeft
  })

  const syncHistory = () => setHistory({ canUndo: undoStack.current.length > 0, canRedo: redoStack.current.length > 0 })

  const hold = useCallback((next: Shared | null) => {
    held.current = next
    if (next) clock.current = Math.max(clock.current, topCounter(next))
    setShared(next)
  }, [])

  const flush = useCallback(() => {
    timer.current = undefined
    const state = held.current
    if (!dirty.current || !state) return
    dirty.current = false
    void channelRef.current?.send({
      type: 'broadcast',
      event: 'state',
      payload: { from: me.current, board: state.board, marks: state.marks, layout: state.layout } satisfies Message,
    })
  }, [])

  /** Queues this browser's state for everyone else; several changes in a row go out as one. */
  const announce = useCallback(() => {
    dirty.current = true
    timer.current ??= setTimeout(flush, PUBLISH_MS)
  }, [flush])

  const stamp = (): Stamp => [++clock.current, me.current]

  /** Applies a change here and sends it on. Works the same whoever is editing. */
  const edit = useCallback(
    (change: (board: Board) => Board) => {
      const state = held.current
      if (!state) return
      const board = change(state.board)
      if (board === state.board) return
      undoStack.current = [...undoStack.current, state]
      redoStack.current = []
      syncHistory()
      hold({ ...state, board, marks: markEdit(state.board, board, state.marks, stamp()) })
      announce()
    },
    [announce, hold],
  )

  const move = useCallback(
    (id: string, point: Point) => {
      const state = held.current
      if (!state) return
      hold({
        ...state,
        layout: { positions: { ...state.layout.positions, [id]: point }, marks: { ...state.layout.marks, [id]: stamp() } },
      })
      announce()
    },
    [announce, hold],
  )

  /** Follows a block whose id changed (a new block renamed before its id was frozen). */
  const renamePosition = useCallback(
    (from: string, to: string) => {
      const state = held.current
      if (!state || from === to) return
      const { [from]: point, ...rest } = state.layout.positions
      if (point === undefined) return
      hold({
        ...state,
        layout: { positions: { ...rest, [to]: point }, marks: { ...state.layout.marks, [from]: stamp(), [to]: stamp() } },
      })
      announce()
    },
    [announce, hold],
  )

  const resetLayout = useCallback(() => {
    const state = held.current
    if (!state) return
    const marks = { ...state.layout.marks }
    for (const id of Object.keys(state.layout.positions)) marks[id] = stamp()
    hold({ ...state, layout: { positions: {}, marks } })
    announce()
  }, [announce, hold])

  /** An undone edit travels like any other: it is stamped now, so it wins over what it undoes. */
  const step = useCallback(
    (from: 'undo' | 'redo') => {
      const state = held.current
      const stack = from === 'undo' ? undoStack : redoStack
      const other = from === 'undo' ? redoStack : undoStack
      const target = stack.current.at(-1)
      if (!state || !target) return
      stack.current = stack.current.slice(0, -1)
      other.current = [...other.current, state]
      syncHistory()
      hold({ ...state, board: target.board, marks: markEdit(state.board, target.board, state.marks, stamp()) })
      announce()
    },
    [announce, hold],
  )

  const undo = useCallback(() => step('undo'), [step])
  const redo = useCallback(() => step('redo'), [step])

  const receive = useCallback(
    (payload: unknown) => {
      const message = payload as Message | null
      if (!message?.from || message.from === me.current || !message.board) return
      const state = held.current
      if (!state) {
        hold({ board: message.board, marks: message.marks, layout: message.layout })
        return
      }
      const merged = mergeBoards({ board: state.board, marks: state.marks }, { board: message.board, marks: message.marks })
      hold({ board: merged.board, marks: merged.marks, layout: mergeLayout(state.layout, message.layout) })
    },
    [hold],
  )

  /** Drops the channel and every trace of the session, without touching the visible state. */
  const closeChannel = useCallback(() => {
    clearTimeout(timer.current)
    timer.current = undefined
    dirty.current = false
    held.current = null
    clock.current = 0
    undoStack.current = []
    redoStack.current = []
    hadHost.current = false
    role.current = null
    attempt.current = null
    const channel = channelRef.current
    channelRef.current = null
    if (channel) void loadedClient()?.removeChannel(channel)
  }, [])

  const syncPeople = useCallback(() => {
    const channel = channelRef.current
    if (!channel) return
    const state = channel.presenceState<{ name?: string; role?: LiveRole }>()
    const people = Object.entries(state).flatMap(([id, metas]) => {
      const meta = metas[0]
      return meta?.role ? [{ id, name: meta.name || 'Someone', role: meta.role }] : []
    })
    setSession((s) => (s ? { ...s, people } : s))

    const host = people.find((p) => p.role === 'host')
    if (host) hadHost.current = true
    else if (hadHost.current && role.current === 'guest' && channel.state === 'joined') {
      // Nothing is stored server-side and the board is the host's process, so their tab closing
      // is the end of the session. Only while properly joined: mid-rejoin (this browser's own
      // blip) the roster is empty for a moment and means nothing.
      const board = held.current?.board ?? null
      closeChannel()
      setSession(null)
      setShared(null)
      setHistory({ canUndo: false, canRedo: false })
      endedRef.current(board)
    }
  }, [closeChannel])

  const open = useCallback(
    (as: LiveRole, key: string, name: string, seed: Shared | null) => {
      const loading = loadClient()
      if (!loading) {
        notifyRef.current('Live sessions need VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.', true)
        return
      }
      closeChannel()
      const id = crypto.randomUUID()
      const opening = {}
      me.current = id
      role.current = as
      attempt.current = opening
      setSession({ role: as, key, name, status: 'connecting', people: [] })
      setHistory({ canUndo: false, canRedo: false })
      hold(seed)

      loading.then(
        (client) => {
          // Left (or started another session) while the client was loading.
          if (attempt.current !== opening) return

          // `self: false` keeps a browser from merging its own messages; the presence key is how
          // everyone else recognises who sent what.
          const channel = client.channel(topic(key), { config: { presence: { key: id }, broadcast: { self: false } } })
          channelRef.current = channel
          channel
            .on('presence', { event: 'sync' }, syncPeople)
            // Someone joining mid-session has missed every message so far — broadcast keeps no
            // history — so they ask, and the host, whose process it is, answers.
            .on('broadcast', { event: 'hello' }, () => {
              if (role.current === 'host' && held.current) {
                dirty.current = true
                flush()
              }
            })
            .on('broadcast', { event: 'state' }, ({ payload }) => receive(payload))
            .subscribe((status) => {
              // A session left (or restarted) while this one was connecting: ignore the late news.
              if (channelRef.current !== channel) return
              if (status === 'SUBSCRIBED') {
                setSession((s) => (s ? { ...s, status: 'live' } : s))
                void channel.track({ name, role: as })
                if (as === 'guest') void channel.send({ type: 'broadcast', event: 'hello', payload: { from: id } })
              } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                setSession((s) => (s ? { ...s, status: 'error' } : s))
              }
            })
        },
        (e: unknown) => {
          if (attempt.current !== opening) return
          setSession((s) => (s ? { ...s, status: 'error' } : s))
          notifyRef.current(e instanceof Error ? e.message : "Couldn't load live sessions.", true)
        },
      )
    },
    [closeChannel, flush, hold, receive, syncPeople],
  )

  /** Shares the open process under a fresh key, which is then the session's whole invitation. */
  const start = useCallback(
    (name: string, board: Board, positions: Record<string, Point>) => {
      const marks = markBoard(board)
      const layout: Layout = { positions, marks: {} }
      // The arrangement starts out as common ground, like the board itself.
      for (const id of Object.keys(positions)) layout.marks[id] = [0, '']
      open('host', newSessionKey(), name, { board, marks, layout })
    },
    [open],
  )

  const join = useCallback((key: string, name: string) => open('guest', key, name, null), [open])

  const leave = useCallback(() => {
    closeChannel()
    setSession(null)
    setShared(null)
    setHistory({ canUndo: false, canRedo: false })
  }, [closeChannel])

  useEffect(() => closeChannel, [closeChannel])

  return {
    configured: liveConfigured,
    session,
    board: shared?.board ?? null,
    positions: shared?.layout.positions ?? null,
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    start,
    join,
    leave,
    edit,
    move,
    renamePosition,
    resetLayout,
    undo,
    redo,
  }
}
