import { useSyncExternalStore } from 'react'

/** Someone else's pointer, where it is in the world — not on their screen. */
export interface RemoteCursor {
  id: string
  name: string
  /** A CSS color, theirs for the session. */
  color: string
  x: number
  y: number
}

/**
 * A subscription rather than a prop, because cursors move constantly: handing them down from
 * the app would re-render the whole editor — sidebar, header, every block — on every pointer
 * move anyone makes. Subscribed here, only this component re-renders.
 */
export interface CursorSource {
  subscribe: (onChange: () => void) => () => void
  /** Must return the same array until something actually changes. */
  get: () => RemoteCursor[]
}

/**
 * Everyone else's pointer, drawn in the canvas world so a cursor sits over the same block for
 * everyone however each of them has panned or zoomed. Each is counter-scaled by the zoom, so a
 * pointer stays its own size on screen instead of growing with the board.
 */
export function RemoteCursors({ source, zoom }: { source: CursorSource; zoom: number }) {
  const cursors = useSyncExternalStore(source.subscribe, source.get)

  return (
    <>
      {cursors.map((cursor) => (
        <div
          key={cursor.id}
          aria-hidden="true"
          className="pointer-events-none absolute top-0 left-0 z-30 flex items-start will-change-transform"
          style={{ transform: `translate(${cursor.x}px, ${cursor.y}px) scale(${1 / zoom})`, transformOrigin: '0 0', color: cursor.color }}
        >
          <Pointer />
          <span
            className="-ml-step-2xs mt-step-lg max-w-40 truncate rounded-md px-chip-inset py-px text-chip font-medium text-white"
            style={{ backgroundColor: cursor.color }}
          >
            {cursor.name}
          </span>
        </div>
      ))}
    </>
  )
}

/** The arrow itself: filled in the person's color, outlined so it stays visible over a block. */
function Pointer() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" className="shrink-0 drop-shadow-sm">
      <path d="M3 1.5 14 8.2l-4.8 1.1L6.6 14 3 1.5Z" fill="currentColor" stroke="white" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  )
}
