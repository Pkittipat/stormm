import { isSlug } from './ids.js'
import type { Issue } from './issues.js'
import { BLOCK_KINDS, SCHEMA_VERSION, connectionKey, type BlockKind, type Board } from './model.js'

/**
 * Usual next steps: readmodel → command → aggregate → event → policy → command,
 * plus event → read model (a read model is built from events). An external system
 * stands where an aggregate would: command → system → event.
 */
const NEXT: Record<BlockKind, BlockKind[]> = {
  readmodel: ['command'],
  command: ['aggregate', 'system'],
  aggregate: ['event'],
  system: ['event'],
  event: ['policy', 'readmodel'],
  policy: ['command'],
}

const KIND_LABEL: Record<BlockKind, string> = {
  readmodel: 'read model',
  command: 'command',
  aggregate: 'aggregate',
  system: 'external system',
  event: 'event',
  policy: 'policy',
}

/**
 * The spec's semantic rules. Errors block saving; warnings are shown but don't.
 * Pair with `parseBoard` for files, or run directly on a board edited in the app.
 */
export function validate(board: Board): Issue[] {
  const issues: Issue[] = []
  const error = (code: string, message: string, path?: string) => issues.push({ level: 'error', code, message, ...(path && { path }) })
  const warn = (code: string, message: string, path?: string) => issues.push({ level: 'warning', code, message, ...(path && { path }) })

  if (board.schemaVersion !== SCHEMA_VERSION) error('schema-version', `Unknown schemaVersion ${board.schemaVersion}.`, 'schemaVersion')
  if (!isSlug(board.id)) error('id-format', `Process id “${board.id}” must be a slug like “place-order”.`, 'id')
  if (!board.name.trim()) error('required', 'The process needs a name.', 'name')

  const blocks = new Map<string, { kind: BlockKind; title: string }>()
  board.blocks.forEach((b, i) => {
    const bp = `blocks[${i}]`
    if (!isSlug(b.id)) error('id-format', `Block id “${b.id}” must be a slug.`, `${bp}.id`)
    if (blocks.has(b.id)) error('duplicate-id', `Two blocks use the id “${b.id}”.`, `${bp}.id`)
    else blocks.set(b.id, { kind: b.kind, title: b.title })
    if (!BLOCK_KINDS.includes(b.kind)) error('unknown-kind', `Block “${b.id}” has unknown kind “${b.kind}”; use one of ${BLOCK_KINDS.join(', ')}.`, `${bp}.kind`)
    if (!b.title.trim()) error('required', `Block “${b.id}” needs a title.`, `${bp}.title`)
    b.invariants.forEach((r, ri) => {
      if (!r.trim()) error('required', `An invariant on “${b.id}” is empty.`, `${bp}.invariants[${ri}]`)
    })
    if (b.invariants.length && b.kind !== 'aggregate')
      warn('invariant-kind', `“${b.title}” is a ${KIND_LABEL[b.kind] ?? b.kind} with invariants; invariants belong to aggregates.`, `${bp}.invariants`)
    b.fields.forEach((f, fi) => {
      if (!f.name.trim()) error('required', `A field on “${b.id}” needs a name.`, `${bp}.fields[${fi}].name`)
    })
  })

  const seen = new Set<string>()
  const connected = new Set<string>()
  board.connections.forEach((c, i) => {
    const path = `connections[${i}]`
    const from = blocks.get(c.from)
    const to = blocks.get(c.to)
    if (!from) error('missing-block', `Connection from “${c.from}” points at a block that doesn't exist.`, `${path}.from`)
    if (!to) error('missing-block', `Connection to “${c.to}” points at a block that doesn't exist.`, `${path}.to`)
    const key = connectionKey(c)
    if (seen.has(key)) error('duplicate-connection', `The connection ${c.from} → ${c.to} is listed twice.`, path)
    seen.add(key)
    if (c.from === c.to) error('self-connection', `Block “${c.from}” is connected to itself.`, path)
    if (!from || !to) return
    connected.add(c.from).add(c.to)
    if (BLOCK_KINDS.includes(from.kind) && BLOCK_KINDS.includes(to.kind) && !NEXT[from.kind].includes(to.kind))
      warn(
        'grammar',
        `“${from.title}” → “${to.title}” is ${KIND_LABEL[from.kind]} → ${KIND_LABEL[to.kind]}; a process usually goes read model → command → aggregate → event → policy → command (or event → read model; an external system can stand in for the aggregate).`,
        path,
      )
  })

  board.blocks.forEach((b, i) => {
    if (!connected.has(b.id)) warn('unconnected', `“${b.title}” isn't connected to anything.`, `blocks[${i}]`)
  })

  return issues
}
