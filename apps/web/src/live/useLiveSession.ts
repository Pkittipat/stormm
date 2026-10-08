import { parseBoard, toYaml, type Board } from '@stormm/process-model'
import { useEffect, useRef, useState } from 'react'
import { WebrtcProvider } from 'y-webrtc'
import * as Y from 'yjs'

/**
 * Peers find each other through a signaling server — the one piece that can't be peer-to-peer,
 * since two browsers that have never met need somewhere to exchange connection details. Board
 * content never goes through it; that flows directly between browsers over WebRTC.
 *
 * `VITE_SIGNALING_URL` points this at your own relay (see `pnpm signal` for a local one, or
 * deploy y-webrtc's `bin/server.js` anywhere). Worth doing for a team: the public servers below
 * are free community instances that go down or get blocked by corporate networks without
 * warning, and when they do, nobody can connect to anyone.
 */
const SIGNALING_SERVERS = import.meta.env.VITE_SIGNALING_URL
  ? [import.meta.env.VITE_SIGNALING_URL]
  : ['wss://y-webrtc-eu.fly.dev', 'wss://signaling.yjs.dev']

/** `connecting` until a signaling server answers; `offline` once they've all failed. */
export type LiveStatus = 'connecting' | 'connected' | 'offline'

export interface LiveSession {
  active: boolean
  status: LiveStatus
  /** Everyone else in the room, however they're reached. A peer in this browser profile is
   * reached both ways at once, so the two transports are unioned rather than added. */
  peers: number
  /** Of those, the ones reached over the network — i.e. actually someone else's browser. Tabs
   * in this same profile sync over BroadcastChannel even with signaling down, which is what
   * makes a same-profile test look like success when nothing can really connect. */
  remotePeers: number
}

/**
 * Pluggable live-collaboration layer: syncs a board's canonical YAML between browsers over
 * WebRTC (via Yjs), with no backend of our own — the signaling servers only ever see which room
 * a peer wants to join, never process content. Entirely additive: it only ever reads `board` and
 * calls `onRemoteBoard` back, through the same `edit()` every other feature uses. Nothing
 * elsewhere needs to know this exists; deleting this file (and its one call site) removes live
 * mode with it, no data-model or storage changes to undo.
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
  const [status, setStatus] = useState<LiveStatus>('connecting')
  const [peers, setPeers] = useState({ total: 0, remote: 0 })

  const onRemoteBoardRef = useRef(onRemoteBoard)
  useEffect(() => {
    onRemoteBoardRef.current = onRemoteBoard
  })

  const lastRemoteBoard = useRef<Board | null>(null)
  const canPublish = useRef(!joining)
  const session = useRef<{ doc: Y.Doc; map: Y.Map<string>; provider: WebrtcProvider } | null>(null)
  const boardRef = useRef(board)
  boardRef.current = board

  // Connect/disconnect whenever the room itself changes.
  useEffect(() => {
    if (!processId || !roomCode) return
    const doc = new Y.Doc()
    const map = doc.getMap<string>('board')
    const provider = new WebrtcProvider(`stormm-live-${processId}-${roomCode}`, doc, { signaling: SIGNALING_SERVERS })
    session.current = { doc, map, provider }
    canPublish.current = !joining
    lastRemoteBoard.current = null
    setStatus('connecting')
    setPeers({ total: 0, remote: 0 })

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

    const onPeers = ({ webrtcPeers, bcPeers }: { webrtcPeers: string[]; bcPeers: string[] }) =>
      setPeers({ total: new Set([...webrtcPeers, ...bcPeers]).size, remote: webrtcPeers.length })
    provider.on('peers', onPeers)

    // Whether a signaling server actually answered — the provider's own `connected` only reports
    // that it *intends* to connect (`room !== null && shouldConnect`), which is true even when
    // every server is unreachable. The real state lives on each signaling socket. Nothing emits
    // it, so poll; it's one boolean read a second. Until one answers nobody outside this browser
    // can find us, and after a grace period that's worth saying out loud rather than sitting on
    // "connecting" forever — indistinguishable from "connected, just alone in the room so far".
    const started = Date.now()
    const poll = setInterval(() => {
      const reachable = provider.signalingConns.some((c) => c.connected)
      setStatus(reachable ? 'connected' : Date.now() - started > 8000 ? 'offline' : 'connecting')
    }, 1000)

    // Deadlock-breaker. A browser that joined by link waits to be sent the board rather than
    // publishing over it — but if *everyone* in the room joined by link (the host reopened the
    // page, say, or shared the link then refreshed) nobody would ever publish and the room would
    // sit silent forever. So once the room has had a moment to send us anything and hasn't, seed
    // it from what we have. Still never from a joiner's empty placeholder: that's the one board
    // that would overwrite real content with nothing.
    const seed = setTimeout(() => {
      if (map.get('yaml')) return
      const b = boardRef.current
      if (!b || (joining && b.blocks.length === 0)) return
      canPublish.current = true
      map.set('yaml', toYaml(b))
    }, 2500)

    return () => {
      clearInterval(poll)
      clearTimeout(seed)
      map.unobserve(onChange)
      provider.off('peers', onPeers)
      provider.destroy()
      doc.destroy()
      session.current = null
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

  return { active, status, peers: peers.total, remotePeers: peers.remote }
}
