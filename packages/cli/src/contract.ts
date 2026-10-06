import { BLOCK_KINDS, type Block, type BlockKind, type Board, type Connection, type Field } from '@stormm/process-model'

/**
 * The storm as a language-neutral contract: every block is a unit of code, every
 * connection a relationship between two units. What the relationships mean in code
 * (a method, a handler, a projection…) is up to each project.
 */
export interface Contract {
  id: string
  name: string
  units: Unit[]
  arrows: Arrow[]
  gaps: string[]
}

export interface Names {
  pascal: string
  camel: string
  snake: string
  kebab: string
}

export interface Unit {
  id: string
  kind: BlockKind
  title: string
  names: Names
  actor?: string
  fields: Field[]
  invariants: string[]
  hotspots: string[]
  /** Ids of the units on the other end of each relationship, by role. */
  links: Partial<Record<LinkRole, string[]>>
}

/** What a connection means, named from both ends. */
export type Role = 'feeds' | 'handles' | 'records' | 'triggers' | 'sends' | 'updates' | 'unusual'
export type LinkRole =
  | 'feeds' | 'fedBy'
  | 'handles' | 'handledBy'
  | 'records' | 'recordedBy'
  | 'triggers' | 'triggeredBy'
  | 'sends' | 'sentBy'
  | 'updates' | 'updatedBy'
  | 'unusualTo' | 'unusualFrom'

export interface Arrow {
  from: string
  to: string
  role: Role
  /** e.g. "Job records Job Created". */
  text: string
}

const words = (text: string) => text.split(/[^A-Za-z0-9]+/).filter(Boolean)
const cap = (w: string) => w[0]!.toUpperCase() + w.slice(1)

export function names(title: string): Names {
  const ws = words(title)
  const pascal = ws.map(cap).join('') || 'Unnamed'
  const lower = ws.map((w) => w.toLowerCase())
  return {
    pascal,
    camel: pascal[0]!.toLowerCase() + pascal.slice(1),
    snake: lower.join('_') || 'unnamed',
    kebab: lower.join('-') || 'unnamed',
  }
}

export const KIND_LABEL: Record<BlockKind, string> = {
  readmodel: 'read model',
  command: 'command',
  aggregate: 'aggregate',
  system: 'external system',
  event: 'event',
  policy: 'policy',
}

/** The storm grammar: which connection means what, and how each end calls the other. */
const ROLES: Partial<Record<`${BlockKind}>${BlockKind}`, [Role, LinkRole, LinkRole]>> = {
  'readmodel>command': ['feeds', 'feeds', 'fedBy'],
  'command>aggregate': ['handles', 'handledBy', 'handles'],
  'aggregate>event': ['records', 'records', 'recordedBy'],
  // An external system takes the aggregate's place: it handles a command and records what came of it.
  'command>system': ['handles', 'handledBy', 'handles'],
  'system>event': ['records', 'records', 'recordedBy'],
  'event>policy': ['triggers', 'triggers', 'triggeredBy'],
  'policy>command': ['sends', 'sends', 'sentBy'],
  'event>readmodel': ['updates', 'updates', 'updatedBy'],
}

export function arrowText(role: Role, from: Block, to: Block) {
  const [a, b] = [from.title, to.title]
  switch (role) {
    case 'feeds': return `${a} feeds ${b}`
    case 'handles': return `${b} handles ${a}`
    case 'records': return `${a} records ${b}`
    case 'triggers': return `${a} triggers ${b}`
    case 'sends': return `${a} sends ${b}`
    case 'updates': return `${a} updates ${b}`
    case 'unusual': return `${a} (${KIND_LABEL[from.kind]}) → ${b} (${KIND_LABEL[to.kind]}), outside the storm grammar`
  }
}

export function roleOf(from: Block, to: Block): Role {
  return ROLES[`${from.kind}>${to.kind}`]?.[0] ?? 'unusual'
}

export function buildContract(board: Board): Contract {
  const byId = new Map(board.blocks.map((b) => [b.id, b]))
  const units = new Map<string, Unit>(
    board.blocks.map((b) => [
      b.id,
      {
        id: b.id,
        kind: b.kind,
        title: b.title,
        names: names(b.title),
        ...(b.actor && { actor: b.actor }),
        fields: b.fields,
        invariants: b.invariants,
        hotspots: b.hotspots,
        links: {},
      },
    ]),
  )
  const link = (u: Unit, role: LinkRole, id: string) => (u.links[role] ??= []).push(id)

  const arrows: Arrow[] = []
  for (const c of board.connections as Connection[]) {
    const from = byId.get(c.from)
    const to = byId.get(c.to)
    if (!from || !to) continue
    const [role, fromRole, toRole] = ROLES[`${from.kind}>${to.kind}`] ?? ['unusual', 'unusualTo', 'unusualFrom']
    link(units.get(from.id)!, fromRole, to.id)
    link(units.get(to.id)!, toRole, from.id)
    arrows.push({ from: from.id, to: to.id, role, text: arrowText(role, from, to) })
  }

  const gaps: string[] = []
  const list = [...units.values()]
  const titles = (ids: string[] = []) => ids.map((id) => `"${units.get(id)!.title}"`).join(', ')
  for (const u of list) {
    const l = u.links
    if (u.kind === 'command' && !l.handledBy) gaps.push(`Command "${u.title}" is not handled by any aggregate or external system: the storm doesn't say what decides it or which event it records.`)
    if (u.kind === 'command' && (l.handledBy?.length ?? 0) > 1) gaps.push(`Command "${u.title}" is handled by more than one aggregate or external system (${titles(l.handledBy)}).`)
    if (u.kind === 'aggregate' && !l.handles) gaps.push(`Aggregate "${u.title}" handles no command.`)
    if (u.kind === 'aggregate' && !l.records) gaps.push(`Aggregate "${u.title}" records no event.`)
    if (u.kind === 'aggregate' && l.handles && !u.invariants.length) gaps.push(`Aggregate "${u.title}" states no invariants: the storm doesn't say when it refuses a command.`)
    if (u.kind === 'aggregate' && (l.handles?.length ?? 0) > 1 && (l.records?.length ?? 0) > 1)
      gaps.push(`Aggregate "${u.title}" handles ${titles(l.handles)} and records ${titles(l.records)}; the storm doesn't say which command records which event.`)
    if (u.kind === 'system' && !l.handles && !l.records) gaps.push(`External system "${u.title}" handles no command and records no event.`)
    if (u.kind === 'event' && !l.recordedBy) gaps.push(`Event "${u.title}" is not recorded by any aggregate or external system.`)
    if (u.kind === 'policy' && !l.triggeredBy) gaps.push(`Policy "${u.title}" is not triggered by any event.`)
    if (u.kind === 'policy' && !l.sends) gaps.push(`Policy "${u.title}" sends no command.`)
    if (u.kind === 'readmodel' && !l.updatedBy) gaps.push(`Read model "${u.title}" is not updated by any event: the storm doesn't say where its data comes from.`)
    // An aggregate's state is the engineers' to design; a policy or external system carries no data of its own here.
    if (!u.fields.length && u.kind !== 'policy' && u.kind !== 'aggregate' && u.kind !== 'system') gaps.push(`${cap(KIND_LABEL[u.kind])} "${u.title}" has no fields.`)
    for (const h of u.hotspots) gaps.push(`Hotspot on "${u.title}": ${h}`)
  }
  // Two units whose code names collide would become one type.
  const seen = new Map<string, Unit>()
  for (const u of list) {
    const key = `${u.kind}:${u.names.pascal}`
    const other = seen.get(key)
    if (other) gaps.push(`"${other.title}" and "${u.title}" are both of kind ${KIND_LABEL[u.kind]} and named ${u.names.pascal} in code.`)
    else seen.set(key, u)
  }

  // Units in grammar order, then file order.
  const ordered = BLOCK_KINDS.flatMap((k) => list.filter((u) => u.kind === k))
  return { id: board.id, name: board.name, units: ordered, arrows, gaps }
}
