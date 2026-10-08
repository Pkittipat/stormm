import { parseDocument } from 'yaml'
import type { Issue } from './issues.js'
import { SCHEMA_VERSION, type Block, type BlockKind, type Board, type Connection, type Field } from './model.js'

export interface ParseResult {
  /** Null when the file can't be read as a v1 board at all. */
  board: Board | null
  issues: Issue[]
}

/**
 * Older schema versions migrate forward here, one step at a time (`1 → 2`, `2 → 3`, …),
 * on the raw parsed object. v1 is the first version, so there is nothing to migrate yet.
 */
const MIGRATIONS: Record<number, (raw: Record<string, unknown>) => Record<string, unknown>> = {}

/**
 * Reads a board from YAML. Any valid file is accepted however it is formatted, including
 * hand edits in a PR; writing it back with `toYaml` gives the canonical form. Structural
 * problems (wrong types, missing required keys) are errors and yield no board; unknown
 * keys are ignored with a warning, so files from a newer minor edit still load.
 * Semantic rules (ids, connections, grammar) are checked separately by `validate`.
 */
export function parseBoard(text: string): ParseResult {
  const issues: Issue[] = []
  const doc = parseDocument(text, { uniqueKeys: true })
  // The yaml library's e.message bundles a source-snippet-and-caret code frame onto the real
  // reason as extra lines; the reason plus "at line L, column C" is always the first line, so
  // drop the rest — a wall of ASCII-art isn't human-readable in a one-line issue row. One typo
  // can also desync the parser into a cascade of a dozen+ follow-on errors that don't say
  // anything the first one didn't; past a few, summarize instead of listing them all.
  const line1 = (m: string) => m.split('\n', 1)[0].replace(/:$/, '')
  const MAX_SYNTAX_ERRORS = 3
  for (const e of doc.errors.slice(0, MAX_SYNTAX_ERRORS)) issues.push({ level: 'error', code: 'yaml-syntax', message: line1(e.message) })
  if (doc.errors.length > MAX_SYNTAX_ERRORS)
    issues.push({
      level: 'error',
      code: 'yaml-syntax',
      message: `${doc.errors.length - MAX_SYNTAX_ERRORS} more syntax error${doc.errors.length - MAX_SYNTAX_ERRORS > 1 ? 's' : ''} follow from the same spot — fix the first one and check again.`,
    })
  for (const w of doc.warnings) issues.push({ level: 'warning', code: 'yaml-warning', message: line1(w.message) })
  if (doc.errors.length) return { board: null, issues }

  const r = new Reader(issues)
  let raw = doc.toJS() as unknown
  if (!isRecord(raw)) {
    r.error('', 'not-a-mapping', 'The file must be a mapping with schemaVersion, id, name and blocks.')
    return { board: null, issues }
  }

  const version = raw.schemaVersion
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    r.error('schemaVersion', 'schema-version', 'schemaVersion must be a positive whole number.')
    return { board: null, issues }
  }
  if (version > SCHEMA_VERSION) {
    r.error('schemaVersion', 'schema-version', `schemaVersion ${version} is newer than this Stormm understands (${SCHEMA_VERSION}).`)
    return { board: null, issues }
  }
  for (let v = version; v < SCHEMA_VERSION; v++) raw = { ...MIGRATIONS[v](raw as Record<string, unknown>), schemaVersion: v + 1 }

  const board = r.board(raw as Record<string, unknown>)
  return { board: r.failed ? null : board, issues }
}

class Reader {
  failed = false
  private readonly issues: Issue[]
  constructor(issues: Issue[]) {
    this.issues = issues
  }

  error(path: string, code: string, message: string) {
    this.failed = true
    this.issues.push({ level: 'error', code, message, ...(path && { path }) })
  }

  private unknownKeys(obj: Record<string, unknown>, known: string[], path: string) {
    for (const key of Object.keys(obj))
      if (!known.includes(key))
        this.issues.push({ level: 'warning', code: 'unknown-key', message: `Unknown key “${key}” is ignored.`, path: join(path, key) })
  }

  private string(obj: Record<string, unknown>, key: string, path: string): string {
    const v = obj[key]
    if (typeof v === 'string' && v.trim()) return v
    this.error(join(path, key), 'required', v === undefined ? `“${key}” is required.` : `“${key}” must be non-empty text.`)
    return ''
  }

  private optionalString(obj: Record<string, unknown>, key: string, path: string): string | undefined {
    const v = obj[key]
    if (v === undefined || v === null || v === '') return undefined
    if (typeof v === 'string') return v
    this.error(join(path, key), 'type', `“${key}” must be text.`)
    return undefined
  }

  private list<T>(obj: Record<string, unknown>, key: string, path: string, required: boolean, item: (v: unknown, path: string) => T): T[] {
    const v = obj[key]
    if (v === undefined || v === null) {
      if (required) this.error(join(path, key), 'required', `“${key}” is required.`)
      return []
    }
    if (!Array.isArray(v)) {
      this.error(join(path, key), 'type', `“${key}” must be a list.`)
      return []
    }
    return v.map((x, i) => item(x, `${join(path, key)}[${i}]`))
  }

  private record(v: unknown, path: string, what: string): Record<string, unknown> {
    if (isRecord(v)) return v
    this.error(path, 'type', `Each ${what} must be a mapping.`)
    return {}
  }

  board(raw: Record<string, unknown>): Board {
    this.unknownKeys(raw, ['schemaVersion', 'id', 'name', 'blocks', 'connections'], '')
    return {
      schemaVersion: SCHEMA_VERSION,
      id: this.string(raw, 'id', ''),
      name: this.string(raw, 'name', ''),
      blocks: this.list(raw, 'blocks', '', true, (v, p) => this.block(v, p)),
      connections: this.list(raw, 'connections', '', false, (v, p) => this.connection(v, p)),
    }
  }

  block(v: unknown, path: string): Block {
    const o = this.record(v, path, 'block')
    this.unknownKeys(o, ['id', 'kind', 'title', 'actor', 'invariants', 'hotspots', 'fields'], path)
    const actor = this.optionalString(o, 'actor', path)
    return {
      id: this.string(o, 'id', path),
      // Unknown kinds are kept as written and reported by `validate`.
      kind: this.string(o, 'kind', path) as BlockKind,
      title: this.string(o, 'title', path),
      ...(actor !== undefined && { actor }),
      invariants: this.list(o, 'invariants', path, false, (x, p) => {
        if (typeof x === 'string') return x
        this.error(p, 'type', 'Each invariant must be text.')
        return ''
      }),
      hotspots: this.list(o, 'hotspots', path, false, (x, p) => {
        if (typeof x === 'string') return x
        this.error(p, 'type', 'Each hotspot must be text.')
        return ''
      }),
      fields: this.list(o, 'fields', path, false, (x, p) => this.field(x, p)),
    }
  }

  field(v: unknown, path: string): Field {
    const o = this.record(v, path, 'field')
    this.unknownKeys(o, ['name', 'type'], path)
    return { name: this.string(o, 'name', path), type: this.optionalString(o, 'type', path) ?? '' }
  }

  connection(v: unknown, path: string): Connection {
    const o = this.record(v, path, 'connection')
    this.unknownKeys(o, ['from', 'to'], path)
    return { from: this.string(o, 'from', path), to: this.string(o, 'to', path) }
  }
}

const join = (path: string, key: string) => (path ? `${path}.${key}` : key)
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
