/** The only version this package writes. See docs/process-yaml-v1.md. */
export const SCHEMA_VERSION = 1

export const BLOCK_KINDS = ['readmodel', 'command', 'aggregate', 'system', 'event', 'policy'] as const
export type BlockKind = (typeof BLOCK_KINDS)[number]

export interface Field {
  name: string
  type: string
}

export interface Block {
  id: string
  kind: BlockKind
  title: string
  actor?: string
  /** Rules an aggregate always protects, in plain words. Only meaningful on aggregates. */
  invariants: string[]
  hotspots: string[]
  fields: Field[]
}

export interface Connection {
  from: string
  to: string
}

/** One process = one `stormm/processes/<id>.yaml` file. */
export interface Board {
  schemaVersion: number
  id: string
  name: string
  blocks: Block[]
  connections: Connection[]
}

export const connectionKey = (c: Connection) => `${c.from}->${c.to}`
