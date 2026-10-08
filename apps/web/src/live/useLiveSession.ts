import { parseBoard, toYaml, type Board } from '@stormm/process-model'
import { useEffect, useRef, useState } from 'react'
import { WebrtcProvider } from 'y-webrtc'
import * as Y from 'yjs'

export interface LiveSession {
  active: boolean
  /** Other browsers currently in the room (not counting this one). */
  peerCount: number
}

/**
 * Pluggable live-collaboration layer: syncs a board's canonical YAML between browsers over
 * WebRTC (via Yjs), with no backend of our own — y-webrtc's public signaling servers only ever
 * see which room a peer wants to join, never process content, which flows peer-to-peer. Entirely
 * additive: it only ever reads `board` and calls `onRemoteBoard` back, through the same `edit()`
 * every other feature uses. Nothing elsewhere needs to know this exists; deleting this file (and
 * its one call site) removes live mode with it, no data-model or storage changes to undo.
 *
 * Sync unit is the whole board, written into one Y.Map key — a last-write-wins register, not a
 * character-level merge (a Y.Text would interleave two concurrent whole-document replacements
 * into broken YAML). Good enough for "mostly one person edits while others watch" in a meeting;
 * two people editing the same block at the same instant means one edit silently wins.
 */
export function useLiveSession(params: {
  processId: string | null
  roomCode: string | null
  /** True for a browser that joined via a live link rather than starting the session itself —
   * it must not publish its (possibly just-created, empty) local board until it has heard from
   * the room at least once, or it could stomp the real content the moment it connects. */
  joining: boolean
  board: Board | null
  onRemoteBoard: (board: Board) => void
}): LiveSession {
  const { processId, roomCode, joining, board, onRemoteBoard } = params
  const active = Boolean(processId && roomCode)
  const [peerCount, setPeerCount] = useState(0)

  const onRemoteBoardRef = useRef(onRemoteBoard)
  useEffect(() => {
    onRemoteBoardRef.current = onRemoteBoard
  })

  const lastRemoteBoard = useRef<Board | null>(null)
  const canPublish = useRef(!joining)
  const session = useRef<{ doc: Y.Doc; map: Y.Map<string>; provider: WebrtcProvider } | null>(null)

  // Connect/disconnect whenever the room itself changes.
  useEffect(() => {
    if (!processId || !roomCode) return
    const doc = new Y.Doc()
    const map = doc.getMap<string>('board')
    const provider = new WebrtcProvider(`stormm-live-${processId}-${roomCode}`, doc, {})
    session.current = { doc, map, provider }
    canPublish.current = !joining
    lastRemoteBoard.current = null

    const onChange = (_e: Y.YMapEvent<string>, transaction: Y.Transaction) => {
      if (transaction.local) return
      const text = map.get('yaml')
      if (!text) return
      const { board: parsed } = parseBoard(text)
      if (!parsed) return
      canPublish.current = true
      lastRemoteBoard.current = parsed
      onRemoteBoardRef.current(parsed)
    }
    map.observe(onChange)

    const onAwareness = () => setPeerCount(Math.max(0, provider.awareness.getStates().size - 1))
    provider.awareness.on('change', onAwareness)
    onAwareness()

    return () => {
      map.unobserve(onChange)
      provider.awareness.off('change', onAwareness)
      provider.destroy()
      doc.destroy()
      session.current = null
      setPeerCount(0)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [processId, roomCode])

  // Publish local board changes — never echoes one that just arrived from the room.
  useEffect(() => {
    if (!active || !board || !canPublish.current) return
    if (board === lastRemoteBoard.current) return
    const s = session.current
    if (!s) return
    const text = toYaml(board)
    if (s.map.get('yaml') === text) return
    s.map.set('yaml', text)
  }, [active, board])

  return { active, peerCount }
}
