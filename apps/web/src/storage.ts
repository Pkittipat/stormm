import { newBoard, newId, parseBoard, SCHEMA_VERSION, toYaml, validate, type Board, type Issue } from '@stormm/process-model'

export interface Project {
  id: string
  name: string
}

export interface ProcessSummary {
  id: string
  name: string
  /** null = listed under "No project". */
  projectId: string | null
  /** The stored YAML can't be read as a process (e.g. a bad hand edit); opening it explains why. */
  broken?: boolean
}

/** One process as stored: its board, which project it's filed under, and what validation says. */
export interface ProcessFile {
  projectId: string | null
  board: Board
  issues: Issue[]
}

export interface ImportResult {
  /** `renamedFrom`: the file's id was already taken here, so the process got a fresh one. */
  imported: { id: string; name: string; file: string; renamedFrom?: string }[]
  skipped: { file: string; reason: string }[]
}

export class StorageError extends Error {
  readonly issues?: Issue[]
  constructor(message: string, issues?: Issue[]) {
    super(message)
    this.issues = issues
  }
}

/**
 * Everything lives in this browser's localStorage:
 *
 *   stormm:processes      → [{ id, projectId }]  (creation order)
 *   stormm:process:<id>   → the process YAML, canonical form
 *   stormm:projects       → [{ id, name }]
 *
 * The process YAML is the record of a process; the index only files it under a project.
 */
const INDEX_KEY = 'stormm:processes'
const PROJECTS_KEY = 'stormm:projects'
const processKey = (id: string) => `stormm:process:${id}`
const layoutKey = (id: string) => `stormm:layout:${id}`

interface IndexEntry {
  id: string
  projectId: string | null
}

function readJson<T>(key: string, fallback: T): T {
  const raw = localStorage.getItem(key)
  if (raw === null) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

/** Writes throw when storage is full or blocked; callers surface that as "Not saved". */
const writeJson = (key: string, value: unknown) => localStorage.setItem(key, JSON.stringify(value))

const readIndex = () => readJson<IndexEntry[]>(INDEX_KEY, [])

function parseStored(id: string): { board: Board | null; issues: Issue[] } {
  const text = localStorage.getItem(processKey(id))
  if (text === null) return { board: null, issues: [{ level: 'error', code: 'missing', message: `${id}.yaml is missing from this browser's storage.` }] }
  return parseBoard(text)
}

/** The stored id must match the process's key; ids are frozen. */
function idIssues(id: string, board: Board): Issue[] {
  return board.id === id
    ? []
    : [{ level: 'error', code: 'id-mismatch', message: `The process is stored as ${id} but its id is “${board.id}”; ids are frozen.`, path: 'id' }]
}

export const storage = {
  listProcesses(): ProcessSummary[] {
    return readIndex().map(({ id, projectId }) => {
      const { board } = parseStored(id)
      return board ? { id, name: board.name, projectId } : { id, name: id, projectId, broken: true }
    })
  },

  getProcess(id: string): ProcessFile {
    const entry = readIndex().find((e) => e.id === id)
    if (!entry) throw new StorageError(`Process ${id} not found`)
    const { board, issues } = parseStored(id)
    if (!board) throw new StorageError(`${id}.yaml can't be read as a process`, issues)
    return { projectId: entry.projectId, board, issues: [...issues, ...validate(board), ...idIssues(id, board)] }
  },

  /**
   * Opens a process by this exact id, creating an empty placeholder if it isn't here yet —
   * for joining a live session on a process this browser has never seen before. Live sync
   * fills it in once connected; the id is whatever the link carries, not freshly generated.
   */
  ensureProcess(id: string, name: string): ProcessFile {
    const index = readIndex()
    const entry = index.find((e) => e.id === id)
    if (entry) {
      const { board, issues } = parseStored(id)
      if (board) return { projectId: entry.projectId, board, issues: [...issues, ...validate(board), ...idIssues(id, board)] }
    }
    const board: Board = { schemaVersion: SCHEMA_VERSION, id, name, blocks: [], connections: [] }
    localStorage.setItem(processKey(id), toYaml(board))
    if (!entry) writeJson(INDEX_KEY, [...index, { id, projectId: null }])
    return { projectId: entry?.projectId ?? null, board, issues: [] }
  },

  createProcess(name: string, projectId: string | null): ProcessFile {
    const index = readIndex()
    const board = newBoard(name, index.map((e) => e.id))
    localStorage.setItem(processKey(board.id), toYaml(board))
    writeJson(INDEX_KEY, [...index, { id: board.id, projectId }])
    return { projectId, board, issues: validate(board) }
  },

  /** Stores the whole process in canonical form. */
  saveProcess(board: Board): void {
    localStorage.setItem(processKey(board.id), toYaml(board))
  },

  /** Renames a process that may not be open; its id stays. */
  renameProcess(id: string, name: string): void {
    const { board, issues } = parseStored(id)
    if (!board) throw new StorageError(`${id}.yaml can't be read as a process`, issues)
    storage.saveProcess({ ...board, name })
  },

  moveProcess(id: string, projectId: string | null): void {
    writeJson(INDEX_KEY, readIndex().map((e) => (e.id === id ? { ...e, projectId } : e)))
  },

  deleteProcess(id: string): void {
    writeJson(INDEX_KEY, readIndex().filter((e) => e.id !== id))
    localStorage.removeItem(processKey(id))
    localStorage.removeItem(layoutKey(id))
  },

  /**
   * Adds storm YAML files as processes, filed under `projectId`. Each keeps its id, or gets a
   * fresh one when that id is already taken here, so nothing already in this browser is overwritten.
   * Files that can't be read as a process are skipped; validation errors don't block the import.
   */
  importProcesses(files: { name: string; text: string }[], projectId: string | null): ImportResult {
    const index = readIndex()
    const taken = new Set(index.map((e) => e.id))
    const result: ImportResult = { imported: [], skipped: [] }
    for (const file of files) {
      const { board } = parseBoard(file.text)
      if (!board) {
        result.skipped.push({ file: file.name, reason: "it isn't a Stormm process YAML" })
        continue
      }
      const id = taken.has(board.id) ? newId(board.id, taken, 'process') : board.id
      taken.add(id)
      localStorage.setItem(processKey(id), toYaml({ ...board, id }))
      index.push({ id, projectId })
      result.imported.push({ id, name: board.name, file: file.name, ...(id !== board.id && { renamedFrom: board.id }) })
    }
    writeJson(INDEX_KEY, index)
    return result
  },

  listProjects(): Project[] {
    return readJson<Project[]>(PROJECTS_KEY, [])
  },

  createProject(name: string): Project {
    const projects = storage.listProjects()
    const project = { id: newId(name, projects.map((p) => p.id), 'project'), name }
    writeJson(PROJECTS_KEY, [...projects, project])
    return project
  },

  renameProject(id: string, name: string): void {
    writeJson(PROJECTS_KEY, storage.listProjects().map((p) => (p.id === id ? { ...p, name } : p)))
  },

  /** Its processes are kept and move to "No project". */
  deleteProject(id: string): void {
    writeJson(INDEX_KEY, readIndex().map((e) => (e.projectId === id ? { ...e, projectId: null } : e)))
    writeJson(PROJECTS_KEY, storage.listProjects().filter((p) => p.id !== id))
  },
}
