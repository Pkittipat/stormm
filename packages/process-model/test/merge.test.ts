import { describe, expect, it } from 'vitest'
import {
  addBlock,
  connect,
  disconnect,
  markBoard,
  markEdit,
  mergeBoards,
  nextStamp,
  removeBlock,
  renameBoard,
  updateBlock,
  type Board,
  type Marked,
} from '../src'
import { checkout } from './fixture'

/** One person in a session: their copy of the board, and what they know about it. */
function client(name: string, board: Board): Marked & { edit: (change: (b: Board) => Board) => void; take: (other: Marked) => void } {
  const side: Marked & { edit: (change: (b: Board) => Board) => void; take: (other: Marked) => void } = {
    board,
    marks: markBoard(board),
    edit(change) {
      const next = change(side.board)
      side.marks = markEdit(side.board, next, side.marks, nextStamp(side.marks, name))
      side.board = next
    },
    take(other) {
      const merged = mergeBoards({ board: side.board, marks: side.marks }, { board: other.board, marks: other.marks })
      side.board = merged.board
      side.marks = merged.marks
    },
  }
  return side
}

/** What everyone must end up with, however the messages were ordered. */
const settle = (a: Marked & { take: (o: Marked) => void }, b: Marked & { take: (o: Marked) => void }) => {
  const sent = { board: a.board, marks: a.marks }
  b.take(sent)
  a.take({ board: b.board, marks: b.marks })
}

const titles = (board: Board) => board.blocks.map((b) => b.title)
const ids = (board: Board) => board.blocks.map((b) => b.id)
const wires = (board: Board) => board.connections.map((c) => `${c.from}->${c.to}`)

describe('merge', () => {
  it('leaves an untouched board alone', () => {
    const ann = client('ann', checkout())
    const ben = client('ben', checkout())
    settle(ann, ben)
    expect(ann.board).toEqual(checkout())
    expect(ben.board).toEqual(checkout())
  })

  it('keeps both edits when two people change different blocks at once', () => {
    const start = checkout()
    const [first, second] = [start.blocks[0]!.id, start.blocks[1]!.id]
    const ann = client('ann', start)
    const ben = client('ben', start)

    ann.edit((b) => updateBlock(b, first, { title: 'Ann was here' }))
    ben.edit((b) => updateBlock(b, second, { title: 'Ben was here' }))
    settle(ann, ben)

    for (const who of [ann, ben]) {
      expect(who.board.blocks.find((b) => b.id === first)!.title).toBe('Ann was here')
      expect(who.board.blocks.find((b) => b.id === second)!.title).toBe('Ben was here')
    }
    expect(ann.board).toEqual(ben.board)
  })

  it('settles on one answer when two people change the same block', () => {
    const start = checkout()
    const id = start.blocks[0]!.id
    const ann = client('ann', start)
    const ben = client('ben', start)

    ann.edit((b) => updateBlock(b, id, { title: 'Ann' }))
    ben.edit((b) => updateBlock(b, id, { title: 'Ben' }))
    settle(ann, ben)

    expect(ann.board).toEqual(ben.board)
    expect(['Ann', 'Ben']).toContain(ann.board.blocks.find((b) => b.id === id)!.title)
  })

  it('keeps both blocks when two people add one at the same moment', () => {
    const start = checkout()
    const ann = client('ann', start)
    const ben = client('ben', start)

    ann.edit((b) => addBlock(b, { kind: 'command', title: 'New command' }).board)
    ben.edit((b) => addBlock(b, { kind: 'command', title: 'New command' }).board)
    // Both derived the same id from the same default title.
    expect(ids(ann.board).at(-1)).toBe(ids(ben.board).at(-1))

    settle(ann, ben)

    expect(ann.board).toEqual(ben.board)
    expect(ann.board.blocks.filter((b) => b.title === 'New command')).toHaveLength(2)
    expect(new Set(ids(ann.board)).size).toBe(ann.board.blocks.length)
  })

  it('does not resurrect a block someone else deleted', () => {
    const start = checkout()
    const id = start.blocks[0]!.id
    const ann = client('ann', start)
    const ben = client('ben', start)

    ann.edit((b) => removeBlock(b, id))
    settle(ann, ben)
    expect(ids(ben.board)).not.toContain(id)

    // Ben edits something else and sends his board back; the deletion must stick.
    ben.edit((b) => renameBoard(b, 'Renamed'))
    settle(ben, ann)
    expect(ids(ann.board)).not.toContain(id)
    expect(ann.board).toEqual(ben.board)
  })

  it('drops the wires of a block deleted elsewhere', () => {
    const start = checkout()
    const wired = start.connections[0]!
    const ann = client('ann', start)
    const ben = client('ben', start)

    ann.edit((b) => removeBlock(b, wired.from))
    settle(ann, ben)

    expect(wires(ben.board)).not.toContain(`${wired.from}->${wired.to}`)
    expect(ben.board).toEqual(ann.board)
  })

  it('keeps a connection one person draws while the other edits a block', () => {
    const start = checkout()
    const [from, to] = [start.blocks[0]!.id, start.blocks.at(-1)!.id]
    const ann = client('ann', start)
    const ben = client('ben', start)

    ann.edit((b) => connect(b, from, to))
    ben.edit((b) => updateBlock(b, to, { actor: 'Customer' }))
    settle(ann, ben)

    expect(wires(ann.board)).toContain(`${from}->${to}`)
    expect(ann.board.blocks.find((b) => b.id === to)!.actor).toBe('Customer')
    expect(ann.board).toEqual(ben.board)
  })

  it('settles whichever order the messages arrive in', () => {
    const start = checkout()
    const [a, b] = [start.blocks[0]!.id, start.blocks[1]!.id]

    const run = (order: 'ann first' | 'ben first') => {
      const ann = client('ann', start)
      const ben = client('ben', start)
      const cat = client('cat', start)
      ann.edit((x) => updateBlock(x, a, { title: 'A' }))
      ben.edit((x) => removeBlock(x, b))
      cat.edit((x) => addBlock(x, { kind: 'event', title: 'Shipped' }).board)

      const sent = [
        { board: ann.board, marks: ann.marks },
        { board: ben.board, marks: ben.marks },
        { board: cat.board, marks: cat.marks },
      ]
      const inbox = order === 'ann first' ? sent : [...sent].reverse()
      for (const who of [ann, ben, cat]) for (const message of inbox) who.take(message)
      // A second pass: everyone gossips what they now hold.
      for (const who of [ann, ben, cat]) for (const other of [ann, ben, cat]) who.take({ board: other.board, marks: other.marks })
      return [ann.board, ben.board, cat.board]
    }

    const [annFirst] = run('ann first')
    const [benFirst, b2, c2] = run('ben first')
    expect(benFirst).toEqual(b2)
    expect(benFirst).toEqual(c2)
    expect(annFirst).toEqual(benFirst)
    expect(titles(annFirst)).toContain('A')
    expect(titles(annFirst)).toContain('Shipped')
    expect(ids(annFirst)).not.toContain(b)
  })

  it('is idempotent — the same message twice changes nothing', () => {
    const start = checkout()
    const ann = client('ann', start)
    const ben = client('ben', start)
    ben.edit((x) => disconnect(x, start.connections[0]!.from, start.connections[0]!.to))

    const message = { board: ben.board, marks: ben.marks }
    ann.take(message)
    const once = ann.board
    ann.take(message)
    expect(ann.board).toEqual(once)
  })

  it('renames the process by whoever typed last', () => {
    const start = checkout()
    const ann = client('ann', start)
    const ben = client('ben', start)
    ann.edit((b) => renameBoard(b, 'Ann'))
    settle(ann, ben)
    expect(ben.board.name).toBe('Ann')

    ben.edit((b) => renameBoard(b, 'Ben'))
    settle(ben, ann)
    expect(ann.board.name).toBe('Ben')
  })
})
