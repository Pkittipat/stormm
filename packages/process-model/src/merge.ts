import { diffBoards } from './diff.js'
import { newId } from './ids.js'
import { connectionKey, type Block, type Board, type Connection } from './model.js'

/**
 * A Lamport stamp: a counter, and the client that wrote it to break ties. Any two stamps
 * compare, so every client resolves a conflict the same way without a server deciding.
 */
export type Stamp = [counter: number, client: string]

/** When one part of a board last changed, and when it first appeared. `gone` is a tombstone. */
export interface Mark {
  at: Stamp
  /** Fixed at creation: it orders blocks and connections, and tells two same-id blocks apart. */
  born: Stamp
  gone?: true
}

/**
 * When each part of a board last changed. Lives only for the length of a live session — never
 * in the YAML, which stays exactly the v1 format.
 */
export interface BoardMarks {
  name: Stamp
  /** By block id. */
  blocks: Record<string, Mark>
  /** By `from->to`. */
  connections: Record<string, Mark>
}

/** One side of a merge: a board, and what it knows about when each part of it changed. */
export interface Marked {
  board: Board
  marks: BoardMarks
}

/** Later of two stamps: higher counter, then higher client id, so the order is total. */
export function isLater(a: Stamp, b: Stamp): boolean {
  return a[0] !== b[0] ? a[0] > b[0] : a[1] > b[1]
}

const same = (a: Stamp, b: Stamp) => a[0] === b[0] && a[1] === b[1]

/** The client every board starts out stamped by. Sorts below any real client id. */
const ORIGIN = ''

/**
 * First marks for a board entering a session. Each block and connection is born at its own
 * counter, in the order it already sits in, so what everyone sees matches the file.
 *
 * Deliberately not stamped with any client: the board a session starts from is everyone's
 * common ancestor, so marking it has to come out identical wherever it's done — otherwise
 * each side reads the other's copy of the same block as a different block.
 */
export function markBoard(board: Board): BoardMarks {
  let n = 0
  const at = (): Stamp => [n++, ORIGIN]
  const marks: BoardMarks = { name: at(), blocks: {}, connections: {} }
  for (const block of board.blocks) {
    const stamp = at()
    marks.blocks[block.id] = { at: stamp, born: stamp }
  }
  for (const connection of board.connections) {
    const stamp = at()
    marks.connections[connectionKey(connection)] = { at: stamp, born: stamp }
  }
  return marks
}

/**
 * Marks for an edit: only what actually changed is stamped, so editing one block never
 * overrides someone else's concurrent edit to another.
 */
export function markEdit(before: Board, after: Board, marks: BoardMarks, stamp: Stamp): BoardMarks {
  const diff = diffBoards(before, after)
  const next: BoardMarks = {
    name: diff.name ? stamp : marks.name,
    blocks: { ...marks.blocks },
    connections: { ...marks.connections },
  }
  const born = (was: Mark | undefined) => was?.born ?? stamp

  for (const block of diff.blocks.added) next.blocks[block.id] = { at: stamp, born: stamp }
  for (const { after: block } of diff.blocks.changed) next.blocks[block.id] = { at: stamp, born: born(marks.blocks[block.id]) }
  for (const block of diff.blocks.removed) next.blocks[block.id] = { at: stamp, born: born(marks.blocks[block.id]), gone: true }

  for (const c of diff.connections.added) next.connections[connectionKey(c)] = { at: stamp, born: stamp }
  for (const c of diff.connections.removed) {
    const key = connectionKey(c)
    next.connections[key] = { at: stamp, born: born(marks.connections[key]), gone: true }
  }
  return next
}

/** The stamp the next edit should carry: one past everything this side has seen. */
export function nextStamp(marks: BoardMarks, client: string): Stamp {
  let top = marks.name[0]
  for (const mark of [...Object.values(marks.blocks), ...Object.values(marks.connections)]) {
    top = Math.max(top, mark.at[0], mark.born[0])
  }
  return [top + 1, client]
}

interface Entry {
  mark: Mark
  /** Absent for a tombstone, or when the side knows the mark but not the thing. */
  block?: Block
}

const entriesOf = (side: Marked): Map<string, Entry> => {
  const blocks = new Map(side.board.blocks.map((b) => [b.id, b]))
  return new Map(Object.entries(side.marks.blocks).map(([id, mark]) => [id, { mark, block: blocks.get(id) }]))
}

/**
 * Two people adding a block at the same moment both derive the same id from the same default
 * title — two different blocks wearing one name. Their birthdays give them away; the younger
 * one is renamed, identically on every client, rather than one of them being swallowed.
 *
 * Returns, per side, the id each block ends up under.
 */
function resolveIds(mine: Marked, theirs: Marked): { mine: Map<string, string>; theirs: Map<string, string> } {
  const out = { mine: new Map<string, string>(), theirs: new Map<string, string>() }
  const taken = new Set([...Object.keys(mine.marks.blocks), ...Object.keys(theirs.marks.blocks)])
  // Sorted so both clients rename in the same order and reach the same ids.
  for (const id of [...taken].sort()) {
    const a = mine.marks.blocks[id]
    const b = theirs.marks.blocks[id]
    if (!a || !b || same(a.born, b.born)) continue
    const fresh = newId(id, taken)
    taken.add(fresh)
    out[isLater(a.born, b.born) ? 'mine' : 'theirs'].set(id, fresh)
  }
  return out
}

/**
 * Folds someone else's board into this one, part by part: for every block, connection and the
 * name, whichever side stamped it later wins, and a removal is just another stamp. Two people
 * editing different blocks at once therefore keep both edits, and — because every client
 * resolves the same way from the same inputs — everyone lands on the same board with nobody
 * in charge. Blocks keep the order they were born in, so the canvas doesn't reshuffle as
 * edits arrive.
 */
export function mergeBoards(mine: Marked, theirs: Marked): Marked {
  const ids = resolveIds(mine, theirs)
  const rename = (side: 'mine' | 'theirs', id: string) => ids[side].get(id) ?? id

  const blocks = new Map<string, Entry>()
  const put = (id: string, entry: Entry) => {
    const held = blocks.get(id)
    // Ties go to `mine`: identical stamps mean both sides already agree.
    if (!held || isLater(entry.mark.at, held.mark.at)) blocks.set(id, entry)
  }
  for (const [id, entry] of entriesOf(mine)) put(rename('mine', id), entry)
  for (const [id, entry] of entriesOf(theirs)) put(rename('theirs', id), entry)

  const live = [...blocks].flatMap(([id, entry]) => (entry.mark.gone || !entry.block ? [] : [{ id, ...entry }]))
  live.sort((x, y) => (isLater(x.mark.born, y.mark.born) ? 1 : -1))
  const present = new Set(live.map((b) => b.id))

  const name = isLater(theirs.marks.name, mine.marks.name) ? theirs : mine
  const connections = mergeConnections(mine, theirs, rename, present)

  return {
    board: {
      ...name.board,
      blocks: live.map((b) => (b.block!.id === b.id ? b.block! : { ...b.block!, id: b.id })),
      connections: connections.live,
    },
    // Tombstones are kept: they are what stops a deletion being undone by someone who hasn't
    // heard about it yet.
    marks: {
      name: name.marks.name,
      blocks: Object.fromEntries([...blocks].map(([id, entry]) => [id, entry.mark])),
      connections: Object.fromEntries(connections.marks),
    },
  }
}

function mergeConnections(
  mine: Marked,
  theirs: Marked,
  rename: (side: 'mine' | 'theirs', id: string) => string,
  present: Set<string>,
): { live: Connection[]; marks: [string, Mark][] } {
  const marks = new Map<string, Mark>()
  const put = (key: string, mark: Mark) => {
    const held = marks.get(key)
    if (!held || isLater(mark.at, held.at)) marks.set(key, mark)
  }
  // A connection's key is built from two block ids, so a renamed block re-keys its wires.
  const rekey = (side: 'mine' | 'theirs', key: string) => {
    const [from, to] = key.split('->')
    return `${rename(side, from!)}->${rename(side, to!)}`
  }
  for (const [key, mark] of Object.entries(mine.marks.connections)) put(rekey('mine', key), mark)
  for (const [key, mark] of Object.entries(theirs.marks.connections)) put(rekey('theirs', key), mark)

  const live = [...marks].flatMap(([key, mark]) => {
    const [from, to] = key.split('->')
    // A wire outlives neither of its blocks: one deleted elsewhere takes its wires with it.
    if (mark.gone || !present.has(from!) || !present.has(to!)) return []
    return [{ connection: { from: from!, to: to! }, mark }]
  })
  live.sort((x, y) => (isLater(x.mark.born, y.mark.born) ? 1 : -1))
  return { live: live.map((c) => c.connection), marks: [...marks] }
}
