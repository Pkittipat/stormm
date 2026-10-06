import { describe, expect, it } from 'vitest'
import { hasErrors, validate, type Board } from '../src'
import { checkout } from './fixture'

const codes = (board: Board) => validate(board).map((i) => `${i.level}:${i.code}`)

describe('validate', () => {
  it('passes the spec example cleanly', () => {
    expect(validate(checkout())).toEqual([])
  })

  it('requires slug ids, unique in the file', () => {
    const b = checkout()
    b.blocks[4].id = 'order'
    b.blocks[0].id = 'The Cart'
    expect(codes(b)).toEqual(expect.arrayContaining(['error:duplicate-id', 'error:id-format']))
  })

  it('rejects unknown kinds', () => {
    const b = checkout()
    ;(b.blocks[2] as { kind: string }).kind = 'gateway'
    expect(validate(b)).toContainEqual(expect.objectContaining({ level: 'error', code: 'unknown-kind', path: 'blocks[2].kind' }))
  })

  it('lets an external system stand where an aggregate would: command → system → event', () => {
    const b = checkout()
    b.blocks.push(
      { id: 'charge-card', kind: 'command', title: 'Charge card', invariants: [], hotspots: [], fields: [] },
      { id: 'payment-gateway', kind: 'system', title: 'Payment gateway', invariants: [], hotspots: [], fields: [] },
      { id: 'card-charged', kind: 'event', title: 'Card charged', invariants: [], hotspots: [], fields: [] },
    )
    b.connections.push({ from: 'charge-card', to: 'payment-gateway' }, { from: 'payment-gateway', to: 'card-charged' })
    expect(validate(b)).toEqual([])
  })

  it('rejects an empty invariant and warns about invariants off an aggregate', () => {
    const b = checkout()
    b.blocks.find((x) => x.id === 'order')!.invariants.push(' ')
    b.blocks.find((x) => x.id === 'place-order')!.invariants.push('The cart is not empty')
    expect(validate(b)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ level: 'error', code: 'required', path: 'blocks[2].invariants[1]' }),
        expect.objectContaining({ level: 'warning', code: 'invariant-kind', path: 'blocks[1].invariants' }),
      ]),
    )
  })

  it('rejects connections to missing blocks, duplicates and self-links', () => {
    const b = checkout()
    b.connections.push({ from: 'order-placed', to: 'ghost' }, { from: 'cart', to: 'place-order' }, { from: 'order', to: 'order' })
    expect(codes(b)).toEqual(expect.arrayContaining(['error:missing-block', 'error:duplicate-connection', 'error:self-connection']))
  })

  it('warns on off-grammar links but accepts event → read model', () => {
    const b = checkout()
    b.connections.push({ from: 'cart', to: 'order' }, { from: 'order-shipped', to: 'cart' })
    const warnings = validate(b).filter((i) => i.level === 'warning')
    expect(warnings).toEqual([expect.objectContaining({ code: 'grammar', path: 'connections[7]' })])
    expect(hasErrors(validate(b))).toBe(false)
  })

  it('warns about unconnected blocks', () => {
    const b = checkout()
    b.blocks.push({ id: 'lonely', kind: 'policy', title: 'Lonely', invariants: [], hotspots: [], fields: [] })
    expect(validate(b)).toEqual([expect.objectContaining({ level: 'warning', code: 'unconnected', path: 'blocks[8]' })])
  })

  it('requires names and titles', () => {
    const b = checkout()
    b.name = ' '
    b.blocks[0].title = ''
    b.blocks[0].fields[0].name = ''
    expect(codes(b).filter((c) => c === 'error:required')).toHaveLength(3)
  })
})
