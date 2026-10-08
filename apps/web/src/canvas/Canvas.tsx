import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { BLOCK_KINDS } from '@stormm/process-model'
import { BlockCard, Menu, MenuItem, MenuLabel, TypeSwatch, ZoomControl, blockKindLabel, type BlockKind } from '../components'
import { BLOCK_HEIGHT, BLOCK_WIDTH, PORT_Y, connectorPath, snap, type Point } from './geometry'
import { selectBlocks, selectedBlockIds, type Selection } from './selection'

export type { Selection } from './selection'

export interface Viewport {
  x: number
  y: number
  zoom: number
}

/** A block where it currently sits: its derived position, or where this viewer dragged it. */
export interface CanvasBlock {
  id: string
  kind: BlockKind
  title: string
  actor?: string
  hotspots: number
  invariants: number
  x: number
  y: number
}

export interface CanvasConnection {
  /** `from->to`, stable across saves. */
  id: string
  from: string
  to: string
}

interface CanvasProps {
  blocks: CanvasBlock[]
  connections: CanvasConnection[]
  selection: Selection
  viewport: Viewport
  onViewportChange: (v: Viewport) => void
  /** Omit all three (a read-only diff view) to disable selecting, dragging and connecting — panning/zooming still work. */
  onSelect?: (s: Selection) => void
  onMoveBlock?: (id: string, x: number, y: number) => void
  onConnect?: (sourceId: string, targetId: string) => void
  /**
   * A wire dropped on empty canvas offers a block menu there; picking a kind adds that block,
   * connected from the source, with its left port at `at` (world coordinates).
   */
  onConnectToNew?: (sourceId: string, kind: BlockKind, at: Point) => void
  /** Double-clicking a block edits its title in place. */
  onRenameBlock?: (id: string, title: string) => void
  /** Right-click on empty canvas: add an unconnected block with its top-left at `at` (world coordinates). */
  onAddBlockAt?: (kind: BlockKind, at: Point) => void
  /** Right-click on a block or connection: delete it. */
  onDeleteBlock?: (id: string) => void
  onDeleteConnection?: (id: string) => void
  /** Floating overlays (composer, empty state) rendered above the world, unscaled. */
  children?: ReactNode
}

const ZOOM_MIN = 0.25
const ZOOM_MAX = 2

type Gesture =
  | { type: 'pan'; start: Point; origin: Viewport; moved: boolean }
  | { type: 'drag'; ids: string[]; start: Point; origins: Map<string, Point>; moved: boolean }
  /** A box drawn on empty canvas; `base` is what was already selected when Shift adds to it. */
  | { type: 'marquee'; start: Point; base: string[]; moved: boolean }
  | { type: 'connect'; sourceId: string; start: Point }

/** How long the viewport must stay still before it's reported to the parent. */
const SETTLE_MS = 150

/**
 * The process canvas: a pannable, zoomable world of blocks and
 * connectors. Owns only transient gesture state (a block mid-drag, a
 * connector mid-draw, the live viewport while panning/zooming); every
 * committed change goes out through the callbacks.
 */
export function Canvas({
  blocks,
  connections,
  selection,
  viewport,
  onViewportChange,
  onSelect,
  onMoveBlock,
  onConnect,
  onRenameBlock,
  onConnectToNew,
  onAddBlockAt,
  onDeleteBlock,
  onDeleteConnection,
  children,
}: CanvasProps) {
  const ref = useRef<HTMLElement>(null)
  const gesture = useRef<Gesture | null>(null)
  /** Blocks being dragged, and how far (world units) — one block, or the whole selection. */
  const [dragOffset, setDragOffset] = useState<{ ids: Set<string>; dx: number; dy: number } | null>(null)
  const [marquee, setMarquee] = useState<{ from: Point; to: Point } | null>(null)
  // Space held: dragging pans instead of drawing a selection box, as in other canvas tools.
  const [spaceHeld, setSpaceHeld] = useState(false)
  useEffect(() => {
    const typing = (e: KeyboardEvent) => e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable="true"]')
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || typing(e)) return
      e.preventDefault()
      setSpaceHeld(true)
    }
    const up = (e: KeyboardEvent) => e.code === 'Space' && setSpaceHeld(false)
    const reset = () => setSpaceHeld(false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', reset)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', reset)
    }
  }, [])
  const [pending, setPending] = useState<{ sourceId: string; to: Point } | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  /** The open menu: a wire left on empty canvas waiting for a block kind, or a right-click on the canvas, a block or a connection. */
  const [menu, setMenu] = useState<(CanvasMenu & { at: Point; bounds: { width: number; height: number } }) | null>(null)
  const openMenu = (m: CanvasMenu, at: Point) => {
    const { clientWidth: width, clientHeight: height } = ref.current!
    setMenu({ ...m, at, bounds: { width, height } })
  }
  /** Closes the menu and drops an unfinished wire: a connect drag in progress, or one waiting in the block menu. */
  const cancelWire = () => {
    if (gesture.current?.type === 'connect') gesture.current = null
    setMenu(null)
    setPending(null)
  }
  // Escape, or leaving the window (switching app/tab mid-drag, where no pointerup ever arrives), drops the wire.
  useEffect(() => {
    if (!menu && !pending) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && cancelWire()
    window.addEventListener('keydown', onKey)
    window.addEventListener('blur', cancelWire)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', cancelWire)
    }
  })

  // The live viewport. Panning and wheel-scrolling update it every frame but only re-render
  // the canvas; the parent hears about it once the view settles (reporting every frame would
  // re-render the whole app per pointer move, which is what made panning stutter).
  const [view, setLive] = useState(viewport)
  const [synced, setSynced] = useState(viewport)
  const [reported, setReported] = useState(viewport)
  if (viewport !== synced) {
    setSynced(viewport)
    // Adopt changes from outside (switching process); ignore our own report coming back.
    if (viewport !== reported) setLive(viewport)
  }
  const settle = useRef<ReturnType<typeof setTimeout>>(undefined)
  const report = (v: Viewport) => {
    clearTimeout(settle.current)
    setReported(v)
    onViewportChange(v)
  }
  const setView = (v: Viewport, when: 'settled' | 'now' = 'settled') => {
    setLive(v)
    clearTimeout(settle.current)
    if (when === 'now') report(v)
    else settle.current = setTimeout(() => report(v), SETTLE_MS)
  }
  useEffect(() => () => clearTimeout(settle.current), [])
  // Event listeners registered once read the current view and setter through refs.
  const live = useRef({ view, setView })
  useLayoutEffect(() => {
    live.current = { view, setView }
  })

  const toWorld = (clientX: number, clientY: number): Point => {
    const rect = ref.current!.getBoundingClientRect()
    return { x: (clientX - rect.left - view.x) / view.zoom, y: (clientY - rect.top - view.y) / view.zoom }
  }

  const blockAt = (p: Point) =>
    [...blocks].reverse().find((b) => p.x >= b.x && p.x <= b.x + BLOCK_WIDTH && p.y >= b.y && p.y <= b.y + BLOCK_HEIGHT)

  const zoomAround = (from: Viewport, next: number, cx: number, cy: number): Viewport => {
    const zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next))
    const k = zoom / from.zoom
    return { zoom, x: cx - (cx - from.x) * k, y: cy - (cy - from.y) * k }
  }

  const zoomStep = (dir: 1 | -1) => {
    const rect = ref.current!.getBoundingClientRect()
    setView(zoomAround(view, Math.round((view.zoom + dir * 0.1) * 10) / 10, rect.width / 2, rect.height / 2), 'now')
  }

  // Wheel needs a non-passive listener to preventDefault the browser's page zoom/scroll. Registered
  // once; several wheel events can land in one frame, so each builds on the latest view, not the render's.
  useEffect(() => {
    const el = ref.current!
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const { view: v, setView: set } = live.current
      const rect = el.getBoundingClientRect()
      const next =
        e.ctrlKey || e.metaKey
          ? zoomAround(v, v.zoom * Math.exp(-e.deltaY * 0.01), e.clientX - rect.left, e.clientY - rect.top)
          : { ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }
      live.current.view = next
      set(next)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // Pan just enough to bring a newly selected block into view (e.g. one just added, or picked from the inspector's Connections list).
  const revealed = useRef<string | null>(null)
  useEffect(() => {
    const id = selection?.type === 'block' ? selection.id : null
    if (id === revealed.current) return
    revealed.current = id
    const b = blocks.find((x) => x.id === id)
    if (!b || !ref.current) return
    const { width, height } = ref.current.getBoundingClientRect()
    const pad = 48
    const { view: v, setView: set } = live.current
    const left = b.x * v.zoom + v.x
    const top = b.y * v.zoom + v.y
    const right = left + BLOCK_WIDTH * v.zoom
    const bottom = top + BLOCK_HEIGHT * v.zoom
    const dx = right > width - pad ? width - pad - right : left < pad ? pad - left : 0
    const dy = bottom > height - pad ? height - pad - bottom : top < pad ? pad - top : 0
    if (dx || dy) set({ ...v, x: v.x + dx, y: v.y + dy }, 'now')
  }, [selection, blocks])

  const onPointerMove = (e: ReactPointerEvent) => {
    const g = gesture.current
    if (!g) return
    if (g.type === 'pan') {
      const dx = e.clientX - g.start.x
      const dy = e.clientY - g.start.y
      if (Math.abs(dx) + Math.abs(dy) > 3) g.moved = true
      setView({ ...g.origin, x: g.origin.x + dx, y: g.origin.y + dy })
    } else if (g.type === 'drag') {
      const dx = (e.clientX - g.start.x) / view.zoom
      const dy = (e.clientY - g.start.y) / view.zoom
      if (Math.abs(dx) + Math.abs(dy) > 3) g.moved = true
      // Follow the pointer exactly; snapping to the grid happens on drop.
      if (g.moved) setDragOffset({ ids: new Set(g.ids), dx, dy })
    } else if (g.type === 'marquee') {
      const to = toWorld(e.clientX, e.clientY)
      if (Math.abs(to.x - g.start.x) + Math.abs(to.y - g.start.y) > 3 / view.zoom) g.moved = true
      if (g.moved) setMarquee({ from: g.start, to })
    } else {
      setPending({ sourceId: g.sourceId, to: toWorld(e.clientX, e.clientY) })
    }
  }

  const onPointerUp = (e: ReactPointerEvent) => {
    const g = gesture.current
    gesture.current = null
    if (!g) return
    if (g.type === 'pan') {
      if (g.moved) setView(view, 'now')
      else onSelect?.(null)
    }
    if (g.type === 'drag') {
      if (onMoveBlock && g.moved && dragOffset) {
        for (const [id, origin] of g.origins) {
          const x = snap(origin.x + dragOffset.dx)
          const y = snap(origin.y + dragOffset.dy)
          if (x !== origin.x || y !== origin.y) onMoveBlock(id, x, y)
        }
      }
      setDragOffset(null)
    }
    if (g.type === 'marquee') {
      setMarquee(null)
      if (!g.moved) return onSelect?.(null)
      // Blocks entirely inside the box are selected, as in other canvas tools.
      const to = toWorld(e.clientX, e.clientY)
      const [left, right] = [Math.min(g.start.x, to.x), Math.max(g.start.x, to.x)]
      const [top, bottom] = [Math.min(g.start.y, to.y), Math.max(g.start.y, to.y)]
      const inside = blocks.filter((b) => b.x >= left && b.x + BLOCK_WIDTH <= right && b.y >= top && b.y + BLOCK_HEIGHT <= bottom).map((b) => b.id)
      onSelect?.(selectBlocks([...new Set([...g.base, ...inside])]))
    }
    if (g.type === 'connect') {
      const at = toWorld(e.clientX, e.clientY)
      const target = blockAt(at)
      const dragged = Math.abs(e.clientX - g.start.x) + Math.abs(e.clientY - g.start.y) > 6
      if (onConnect && target && target.id !== g.sourceId) onConnect(g.sourceId, target.id)
      if (!target && dragged && onConnectToNew) {
        // Keep the wire drawn to the drop point while the menu is open.
        openMenu({ type: 'wire', sourceId: g.sourceId }, at)
        setPending({ sourceId: g.sourceId, to: at })
      } else setPending(null)
    }
  }

  const capture = (e: ReactPointerEvent) => ref.current!.setPointerCapture(e.pointerId)

  const positioned = blocks.map((b) => (dragOffset?.ids.has(b.id) ? { ...b, x: b.x + dragOffset.dx, y: b.y + dragOffset.dy } : b))
  const selectedIds = new Set(selectedBlockIds(selection))
  // While a wire is being drawn, highlight whatever block is under the pointer as the drop target.
  const connectHoverId = pending && blockAt(pending.to)?.id
  const connectHoverTarget = connectHoverId && connectHoverId !== pending!.sourceId ? connectHoverId : undefined
  const byId = new Map(positioned.map((b) => [b.id, b]))
  const rightPort = (b: CanvasBlock) => ({ x: b.x + BLOCK_WIDTH, y: b.y + PORT_Y })
  const leftPort = (b: CanvasBlock) => ({ x: b.x, y: b.y + PORT_Y })

  return (
    <section
      ref={ref}
      aria-label="Process canvas"
      className={`relative flex-grow touch-none overflow-hidden bg-surface select-none ${
        pending ? 'cursor-crosshair' : dragOffset ? 'cursor-grabbing' : spaceHeld ? 'cursor-grab' : ''
      }`}
      style={{
        backgroundImage: 'radial-gradient(var(--color-canvas-dot) 1px, transparent 1px)',
        backgroundSize: `${20 * view.zoom}px ${20 * view.zoom}px`,
        backgroundPosition: `${view.x}px ${view.y}px`,
      }}
      onPointerDown={(e) => {
        if (menu && !(e.target as HTMLElement).closest('[role=menu]')) cancelWire()
        if (e.target !== e.currentTarget) return
        // Drag on empty canvas draws a selection box (Shift adds to the selection); Space+drag or the middle button pans.
        const pan = e.button === 1 || (e.button === 0 && (spaceHeld || !onSelect))
        if (!pan && e.button !== 0) return
        e.preventDefault()
        capture(e)
        gesture.current = pan
          ? { type: 'pan', start: { x: e.clientX, y: e.clientY }, origin: view, moved: false }
          : { type: 'marquee', start: toWorld(e.clientX, e.clientY), base: e.shiftKey ? [...selectedIds] : [], moved: false }
      }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={(e) => (gesture.current?.type === 'connect' ? cancelWire() : onPointerUp(e))}
      // Capture can be lost without a pointerup (e.g. the window loses focus); a wire mid-draw is then abandoned.
      onLostPointerCapture={() => gesture.current?.type === 'connect' && cancelWire()}
      onContextMenu={(e) => {
        if ((e.target as HTMLElement).closest('[role=menu], textarea')) return
        e.preventDefault()
        cancelWire()
        const at = toWorld(e.clientX, e.clientY)
        const connectionId = (e.target as Element).closest('[data-connection-id]')?.getAttribute('data-connection-id')
        const block = connectionId ? undefined : blockAt(at)
        if (connectionId) {
          onSelect?.({ type: 'connection', id: connectionId })
          if (onDeleteConnection) openMenu({ type: 'connection', id: connectionId }, at)
        } else if (block) {
          onSelect?.({ type: 'block', id: block.id })
          if (onRenameBlock || onDeleteBlock) openMenu({ type: 'block', id: block.id }, at)
        } else if (onAddBlockAt) openMenu({ type: 'canvas' }, at)
      }}
      // Pointer capture retargets clicks to the canvas itself, so find the block under the pointer here.
      onDoubleClick={(e) => {
        if (!onRenameBlock || (e.target as HTMLElement).closest('textarea')) return
        const target = blockAt(toWorld(e.clientX, e.clientY))
        if (target) setEditingId(target.id)
      }}
    >
      <div
        className="pointer-events-none absolute top-0 left-0 origin-top-left will-change-transform"
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}
      >
        <svg className="absolute top-0 left-0 overflow-visible" width="1" height="1" aria-label="Connections">
          {connections.map((c) => {
            const source = byId.get(c.from)
            const target = byId.get(c.to)
            if (!source || !target) return null
            const d = connectorPath(rightPort(source), leftPort(target))
            const selected = (selection?.type === 'connection' && selection.id === c.id) || (selectedIds.has(c.from) && selectedIds.has(c.to) && selectedIds.size > 1)
            const stroke = selected ? 'var(--color-accent)' : 'var(--color-connector)'
            return (
              <g key={c.id}>
                <path d={d} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinecap="round" />
                {/* Wide invisible twin so the 1.5px line is clickable. */}
                <path
                  d={d}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={12}
                  data-connection-id={c.id}
                  className="pointer-events-auto cursor-pointer"
                  onPointerDown={(e) => {
                    e.stopPropagation()
                    onSelect?.({ type: 'connection', id: c.id })
                  }}
                />
              </g>
            )
          })}
          {pending && byId.get(pending.sourceId) && (
            <path d={connectorPath(rightPort(byId.get(pending.sourceId)!), pending.to)} fill="none" stroke="var(--color-accent)" strokeWidth={1.5} strokeDasharray="4 4" />
          )}
        </svg>

        {marquee && (
          <div
            aria-hidden="true"
            className="absolute rounded-sm border border-accent bg-accent/[8%]"
            style={{
              left: Math.min(marquee.from.x, marquee.to.x),
              top: Math.min(marquee.from.y, marquee.to.y),
              width: Math.abs(marquee.to.x - marquee.from.x),
              height: Math.abs(marquee.to.y - marquee.from.y),
              borderWidth: 1 / view.zoom,
              zIndex: 20,
            }}
          />
        )}

        {positioned.map((b) => (
          <div
            key={b.id}
            data-block-id={b.id}
            className={`pointer-events-auto absolute ${onMoveBlock ? (dragOffset?.ids.has(b.id) ? 'cursor-grabbing' : 'cursor-grab') : onSelect ? 'cursor-pointer' : ''}`}
            style={{ left: b.x, top: b.y }}
            onPointerDown={(e) => {
              if (e.button !== 0 || !onSelect || spaceHeld) return
              e.stopPropagation()
              if (e.shiftKey) {
                // Shift+click adds the block to the selection, or takes it out.
                const ids = selectedIds.has(b.id) ? [...selectedIds].filter((id) => id !== b.id) : [...selectedIds, b.id]
                return onSelect(selectBlocks(ids))
              }
              capture(e)
              // Pressing a block that's part of a multi-selection drags the whole selection.
              const group = selectedIds.size > 1 && selectedIds.has(b.id) ? [...selectedIds] : [b.id]
              if (group.length === 1) onSelect({ type: 'block', id: b.id })
              const origins = new Map(blocks.filter((x) => group.includes(x.id)).map((x) => [x.id, { x: x.x, y: x.y }]))
              if (onMoveBlock) gesture.current = { type: 'drag', ids: group, start: { x: e.clientX, y: e.clientY }, origins, moved: false }
            }}
          >
            <BlockCard
              kind={b.kind}
              title={b.title}
              actor={b.actor}
              hotspots={b.hotspots}
              invariants={b.invariants}
              selected={selectedIds.has(b.id) || connectHoverTarget === b.id}
              editing={editingId === b.id}
              onTitleCommit={(title) => onRenameBlock?.(b.id, title)}
              onEditEnd={() => setEditingId(null)}
              onConnectStart={
                onConnect &&
                ((e) => {
                  if (e.button !== 0) return
                  e.stopPropagation()
                  capture(e)
                  gesture.current = { type: 'connect', sourceId: b.id, start: { x: e.clientX, y: e.clientY } }
                  setPending({ sourceId: b.id, to: toWorld(e.clientX, e.clientY) })
                })
              }
            />
          </div>
        ))}
      </div>

      {menu && (
        // Tabbing (or otherwise moving focus) out of the menu closes it, dropping any wire.
        <div className="contents" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && cancelWire()}>
          <Menu
            aria-label={menu.type === 'wire' ? 'Add connected block' : menu.type === 'canvas' ? 'Canvas options' : `${menu.type === 'block' ? 'Block' : 'Connection'} options`}
            className="z-30"
            style={menuPosition(view.x + menu.at.x * view.zoom, view.y + menu.at.y * view.zoom, menuRows(menu.type), menu.bounds)}
          >
            {menu.type === 'wire' || menu.type === 'canvas' ? (
              <>
                <MenuLabel>Add block</MenuLabel>
                {BLOCK_KINDS.map((kind) => (
                  <MenuItem
                    key={kind}
                    autoFocus={kind === BLOCK_KINDS[0]}
                    onClick={() => {
                      cancelWire()
                      if (menu.type === 'wire') onConnectToNew?.(menu.sourceId, kind, menu.at)
                      else onAddBlockAt?.(kind, menu.at)
                    }}
                  >
                    <span className="flex items-center gap-step-md">
                      <TypeSwatch kind={kind} size="md" />
                      {blockKindLabel[kind]}
                    </span>
                  </MenuItem>
                ))}
              </>
            ) : menu.type === 'block' ? (
              <>
                {onRenameBlock && (
                  <MenuItem
                    autoFocus
                    onClick={() => {
                      cancelWire()
                      setEditingId(menu.id)
                    }}
                  >
                    Rename
                  </MenuItem>
                )}
                {onDeleteBlock && (
                  <MenuItem
                    danger
                    autoFocus={!onRenameBlock}
                    onClick={() => {
                      cancelWire()
                      onDeleteBlock(menu.id)
                    }}
                  >
                    Delete block
                  </MenuItem>
                )}
              </>
            ) : (
              <MenuItem
                danger
                autoFocus
                onClick={() => {
                  cancelWire()
                  onDeleteConnection?.(menu.id)
                }}
              >
                Delete connection
              </MenuItem>
            )}
          </Menu>
        </div>
      )}

      <div className="absolute top-step-2xl left-step-2xl">
        <ZoomControl percent={Math.round(view.zoom * 100)} onZoomIn={() => zoomStep(1)} onZoomOut={() => zoomStep(-1)} />
      </div>

      {children}
    </section>
  )
}

type CanvasMenu =
  | { type: 'wire'; sourceId: string }
  | { type: 'canvas' }
  | { type: 'block'; id: string }
  | { type: 'connection'; id: string }

/** Item rows per menu, to keep it on screen: the block-kind menus have a label plus a row per kind. */
const menuRows = (type: CanvasMenu['type']) => (type === 'wire' || type === 'canvas' ? BLOCK_KINDS.length + 1 : type === 'block' ? 2 : 1)

/** Menu width (--spacing-menu-width), row height and padding. */
const MENU = { width: 184, row: 30, padding: 14, gap: 8 }

/** Beside the point, flipped left or nudged up so the menu stays inside the canvas. */
function menuPosition(x: number, y: number, rows: number, bounds: { width: number; height: number }) {
  const { width, gap } = MENU
  const height = rows * MENU.row + MENU.padding
  const left = x + gap + width <= bounds.width ? x + gap : Math.max(gap, x - gap - width)
  const top = Math.max(gap, Math.min(y - 16, bounds.height - height - gap))
  return { left, top }
}
