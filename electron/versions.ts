import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { ProjectVersion, VersionKind } from '../shared/app'
import { ensureDir, userDir, writeFileAtomic } from './integrations/paths'

/**
 * Version history: a copy of the project at every save, plus a snapshot every so
 * often while editing and one before any restore. Versions are kept per project
 * id, so they follow a project when its file is renamed or moved, and thin out
 * with age — the newest 30 all stay, then the last of each day for 60 days.
 */

const KEEP_ALL = 30
const KEEP_DAYS = 60

interface IndexEntry extends ProjectVersion {
  file: string
  hash: string
}

const root = () => path.join(userDir(), 'versions')
const safe = (id: string) => id.replace(/[^\w-]/g, '').slice(0, 80) || 'untitled'
const dirFor = (projectId: string) => path.join(root(), safe(projectId))

interface Summary {
  name?: unknown
  clips?: Record<string, { start?: number; duration?: number }>
  settings?: { fps?: number }
}

/** What the list says about a version, from the version itself. */
function describe(file: string, envelopeText: string, savedAt: number, kind: VersionKind): IndexEntry {
  const project = (JSON.parse(envelopeText) as { project?: Summary }).project ?? {}
  const clips = Object.values(project.clips ?? {})
  const end = clips.reduce((m, c) => Math.max(m, (c.start ?? 0) + (c.duration ?? 0)), 0)
  return {
    id: file,
    file,
    // What changed is the project, not when it was written.
    hash: createHash('sha1').update(JSON.stringify(project)).digest('hex'),
    savedAt,
    kind,
    name: typeof project.name === 'string' ? project.name : 'Untitled',
    clips: clips.length,
    seconds: Math.round((end / (project.settings?.fps || 30)) * 10) / 10,
    size: Buffer.byteLength(envelopeText),
  }
}

const VERSION_FILE = /^(\d+)-(save|auto|restore)(?:-\d+)?\.lumen$/

/**
 * The versions in `dir`, newest first. The list is index.json — but the
 * versions are the files: one that is there and not listed (Lumen stopped
 * between writing it and listing it, or the list itself was lost) is read
 * and listed again, rather than left on disk where nothing shows it and
 * nothing would ever thin it out.
 */
function readIndex(dir: string): IndexEntry[] {
  let list: IndexEntry[] = []
  try {
    const stored = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8')) as IndexEntry[]
    if (Array.isArray(stored)) list = stored.filter((v) => v && typeof v.file === 'string' && fs.existsSync(path.join(dir, v.file)))
  } catch {
    // No list yet, or one that can't be read: the files say what there is.
  }
  let names: string[]
  try {
    names = fs.readdirSync(dir)
  } catch {
    return list
  }
  const listed = new Set(list.map((v) => v.file))
  const found: IndexEntry[] = []
  for (const name of names) {
    const m = VERSION_FILE.exec(name)
    if (!m || listed.has(name)) continue
    try {
      found.push(describe(name, fs.readFileSync(path.join(dir, name), 'utf8'), Number(m[1]), m[2] as VersionKind))
    } catch {
      // Half a file from an interrupted write: not a version anyone can go back to.
    }
  }
  return found.length ? [...list, ...found].sort((a, b) => b.savedAt - a.savedAt) : list
}

function writeIndex(dir: string, list: IndexEntry[]) {
  writeFileAtomic(path.join(dir, 'index.json'), JSON.stringify(list))
}

/** Stores a version of a project (the .lumen envelope text). Identical back-to-back versions are skipped. */
export function writeVersion(projectId: string, envelopeText: string, kind: VersionKind) {
  const dir = ensureDir(dirFor(projectId))
  const savedAt = Date.now()
  const list = readIndex(dir)
  // Saves can land in the same millisecond: each version needs its own file.
  let file = `${savedAt}-${kind}.lumen`
  for (let n = 2; fs.existsSync(path.join(dir, file)); n++) file = `${savedAt}-${kind}-${n}.lumen`
  const entry = describe(file, envelopeText, savedAt, kind)
  if (list[0]?.hash === entry.hash && kind !== 'save') return
  // Whole or not at all: a version is what one goes back to when something went wrong.
  writeFileAtomic(path.join(dir, file), envelopeText)
  writeIndex(dir, prune(dir, [entry, ...list]))
}

/** Keeps the newest KEEP_ALL, then the newest of each day for KEEP_DAYS; deletes the rest. */
function prune(dir: string, list: IndexEntry[]): IndexEntry[] {
  const keep: IndexEntry[] = []
  const days = new Set<string>()
  const cutoff = Date.now() - KEEP_DAYS * 86_400_000
  list.forEach((v, i) => {
    const day = new Date(v.savedAt).toDateString()
    const kept = i < KEEP_ALL || (v.savedAt >= cutoff && !days.has(day))
    if (i >= KEEP_ALL || kept) days.add(day)
    if (kept) keep.push(v)
    else fs.rmSync(path.join(dir, v.file), { force: true })
  })
  return keep
}

export function listVersions(projectId: string): ProjectVersion[] {
  return readIndex(dirFor(projectId)).map(({ file: _file, hash: _hash, ...v }) => v)
}

/** A stored version's envelope text. */
export function readVersionText(projectId: string, versionId: string): string {
  const dir = dirFor(projectId)
  const entry = readIndex(dir).find((v) => v.id === versionId)
  if (!entry) throw new Error('That version is no longer there.')
  return fs.readFileSync(path.join(dir, entry.file), 'utf8')
}
