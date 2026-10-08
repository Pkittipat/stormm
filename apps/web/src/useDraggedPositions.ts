import type { Point } from '@stormm/process-model'
import { useCallback, useState } from 'react'

type Positions = Record<string, Point>

const key = (processId: string) => `stormm:layout:${processId}`

function read(processId: string | null): Positions {
  if (!processId) return {}
  try {
    const raw = localStorage.getItem(key(processId))
    const parsed: unknown = raw ? JSON.parse(raw) : {}
    return typeof parsed === 'object' && parsed !== null ? (parsed as Positions) : {}
  } catch {
    return {}
  }
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

function write(processId: string, positions: Positions) {
  try {
    if (Object.keys(positions).length) localStorage.setItem(key(processId), JSON.stringify(positions))
    else localStorage.removeItem(key(processId))
  } catch {
    // Storage unavailable (private window, blocked): drags just last for this page load.
  }
}

/**
 * Where this viewer dragged blocks to, per process and block id. A personal view preference:
 * it lives in this browser's localStorage next to the process, never in the YAML itself,
 * and any block without an entry sits at its derived position.
 */
export function useDraggedPositions(processId: string | null, blockIds: readonly string[] | null) {
  const [state, setState] = useState(() => ({ processId, positions: read(processId) }))
  let positions = state.positions
  if (state.processId !== processId) {
    positions = read(processId)
    setState({ processId, positions })
  }

  // Forget blocks that no longer exist, so a later block reusing the id starts fresh.
  if (processId && blockIds) {
    const live = new Set(blockIds)
    const stale = Object.keys(positions).filter((id) => !live.has(id))
    if (stale.length) {
      positions = Object.fromEntries(Object.entries(positions).filter(([id]) => live.has(id)))
      write(processId, positions)
      setState({ processId, positions })
    }
  }

  const move = useCallback(
    (id: string, point: Point) => {
      if (!processId) return
      setState((s) => {
        const next = { ...s.positions, [id]: point }
        write(processId, next)
        return { processId, positions: next }
      })
    },
    [processId],
  )

  /** Follows a block whose id changed (a new block renamed before it was frozen). */
  const rename = useCallback(
    (from: string, to: string) => {
      if (!processId || from === to) return
      setState((s) => {
        if (!(from in s.positions)) return s
        const { [from]: point, ...rest } = s.positions
        const next = { ...rest, [to]: point }
        write(processId, next)
        return { processId, positions: next }
      })
    },
    [processId],
  )

  const reset = useCallback(() => {
    if (!processId) return
    write(processId, {})
    setState({ processId, positions: {} })
  }, [processId])

  /** Takes the whole arrangement from elsewhere — a live session, where it's shared. */
  const replace = useCallback(
    (next: Positions) => {
      if (!processId) return
      setState((s) => {
        if (sameJson(s.positions, next)) return s
        write(processId, next)
        return { processId, positions: next }
      })
    },
    [processId],
  )

  return { positions, move, rename, reset, replace }
}
