import { useLayoutEffect, useRef, useState, type PointerEvent, type RefObject } from 'react'
import { Chip } from './Chip'
import { TypeSwatch } from './TypeSwatch'
import { blockKindClasses, blockKindLabel, type BlockKind } from './types'

interface BlockCardProps {
  kind: BlockKind
  title: string
  selected?: boolean
  /** Who performs this step (e.g. "Customer") — an attribute of the block, never a block of its own. */
  actor?: string | null
  hotspots?: number
  /** How many rules (invariants) an aggregate protects. */
  invariants?: number
  /** Shows the title as a text box (double-click on the canvas); Enter or blur commits, Escape cancels. */
  editing?: boolean
  onTitleCommit?: (title: string) => void
  onEditEnd?: () => void
  /** Makes the right-hand port a drag handle for drawing an outgoing connection. */
  onConnectStart?: (e: PointerEvent<HTMLSpanElement>) => void
  /** Absolutely-positions the card on a canvas. Omit to let it flow inline (as in a palette/showcase). */
  position?: { left: number; top: number }
}

/**
 * The core unit of the process canvas — a 140×104 card (a long title shrinks to fit rather than being cut off) representing one
 * of the six domain concepts. Selection is accent-driven, not type-
 * driven: a selected card always gets a 1.5px accent border + a
 * ring-accent/[14%] glow, regardless of `kind` (its own `-line` border
 * is dropped while selected). Connector ports (the small circles on the
 * left/right edge) switch from --color-port to --color-accent the same
 * way. Renders inline by default; pass `position` to place it
 * absolutely on a canvas surface (the parent must be `position:
 * relative`).
 */
export function BlockCard({ kind, title, selected = false, actor, hotspots, invariants, editing, onTitleCommit, onEditEnd, onConnectStart, position }: BlockCardProps) {
  const { surface, line } = blockKindClasses[kind]
  const portClass = selected ? 'border-accent' : 'border-port'
  const border = selected ? 'border-[1.5px] border-accent' : line
  const ring = selected ? 'ring-4 ring-accent/[14%]' : ''

  return (
    <div className="flex flex-col gap-step-2xs" style={position ? { position: 'absolute', left: position.left, top: position.top } : undefined}>
      <div className="flex items-center gap-step-xs px-step-2xs font-mono text-micro font-medium tracking-mono-label text-text-muted uppercase">
        <TypeSwatch kind={kind} />
        {blockKindLabel[kind]}
      </div>
      <div className={`relative box-border flex h-node-height w-node-width flex-col gap-step-xs rounded-node border p-step-lg ${surface} ${border} ${ring}`}>
        {editing ? (
          <TitleEditor title={title} onCommit={(t) => onTitleCommit?.(t)} onDone={() => onEditEnd?.()} />
        ) : (
          <FitTitle title={title} />
        )}
        {actor || hotspots || invariants ? (
          <div className="mt-auto flex gap-step-2xs">
            {actor && <Chip variant="actor">{actor}</Chip>}
            {invariants ? (
              <Chip variant="invariant" icon={<ShieldIcon />} aria-label={`${invariants} invariant${invariants > 1 ? 's' : ''}`}>
                {invariants}
              </Chip>
            ) : null}
            {hotspots ? (
              <Chip variant="hotspot" icon={<QuestionIcon />} aria-label={`${hotspots} hotspot`}>
                {hotspots}
              </Chip>
            ) : null}
          </div>
        ) : null}
        <Port className={portClass} side="left" />
        <Port className={portClass} side="right" onPointerDown={onConnectStart} />
      </div>
    </div>
  )
}

const TITLE_MAX_PX = 15 // --text-emphasis
const TITLE_MIN_PX = 8

/** Steps the font size down until the text fits its box, so the card keeps its size and nothing is cut off. */
function useFitText(ref: RefObject<HTMLElement | null>, text: string) {
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    let size = TITLE_MAX_PX
    el.style.fontSize = `${size}px`
    while (el.scrollHeight > el.clientHeight && size > TITLE_MIN_PX) el.style.fontSize = `${--size}px`
  }, [ref, text])
}

function FitTitle({ title }: { title: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useFitText(ref, title)
  return (
    <div ref={ref} className="min-h-0 flex-1 overflow-hidden text-emphasis font-semibold break-words text-text">
      {title}
    </div>
  )
}

/** The card's title, edited in place: same type and color as the title, no box of its own, shrinking to fit like the title does. The pointer stays in it (no drag or pan while editing). */
function TitleEditor({ title, onCommit, onDone }: { title: string; onCommit: (title: string) => void; onDone: () => void }) {
  const [draft, setDraft] = useState(title)
  const ref = useRef<HTMLTextAreaElement>(null)
  useFitText(ref, draft)
  // Enter/Escape end it; the blur that follows as it unmounts must not commit a second time.
  const done = useRef(false)
  const finish = (commit: boolean) => {
    if (done.current) return
    done.current = true
    const next = draft.trim()
    if (commit && next && next !== title) onCommit(next)
    onDone()
  }
  return (
    <textarea
      ref={ref}
      aria-label="Block title"
      autoFocus
      value={draft}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setDraft(e.target.value.replace(/\n/g, ' '))}
      onPointerDown={(e) => e.stopPropagation()}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') {
          e.preventDefault()
          finish(true)
        }
        if (e.key === 'Escape') finish(false)
      }}
      className="m-0 block min-h-0 w-full flex-1 resize-none overflow-hidden border-0 bg-transparent p-0 font-sans text-emphasis font-semibold break-words text-text caret-accent outline-none"
    />
  )
}

function Port({
  side,
  className,
  onPointerDown,
}: {
  side: 'left' | 'right'
  className: string
  onPointerDown?: (e: PointerEvent<HTMLSpanElement>) => void
}) {
  return (
    <span
      aria-hidden="true"
      data-port={side}
      onPointerDown={onPointerDown}
      className={`absolute top-11.75 ${
        // An invisible 25px hit area around the 9px dot, so it's grabbable.
        onPointerDown ? "cursor-crosshair before:absolute before:-inset-2 before:content-['']" : ''
      } box-border h-indicator-lg w-indicator-lg rounded-full border-[1.5px] bg-surface-raised ${
        side === 'left' ? '-left-indicator-offset' : '-right-indicator-offset'
      } ${className}`}
    />
  )
}

/** Marks the invariant count: rules the aggregate protects. */
function ShieldIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6l7-3z" />
    </svg>
  )
}

/** Marks the hotspot count: open questions. */
function QuestionIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9.5" />
      <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17.3h.01" />
    </svg>
  )
}
