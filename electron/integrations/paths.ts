import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { app } from 'electron'

/**
 * Everything Lumen renders or downloads lives under userData/media and is
 * served to the editor through the `lumen-media://` protocol, so project files
 * keep working across restarts (unlike blob: URLs).
 */
export const MEDIA_SCHEME = 'lumen-media'
const MEDIA_HOST = 'local'
/** User files (imports, project media) are served from their own location as lumen-media://file/<encoded path>. */
const FILE_HOST = 'file'

export const userDir = () => app.getPath('userData')
export const mediaRoot = () => path.join(userDir(), 'media')

export function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/** A fresh folder for one job's output, e.g. media/blender/<jobId>. */
export const jobDir = (integration: string, jobId: string) => ensureDir(path.join(mediaRoot(), integration, jobId))

/** Where an integration's scratch folders are. */
export const workRoot = (integration: string) => path.join(app.getPath('temp'), 'lumen', integration)

/** Scratch space for scripts and compositions (not served). */
export const workDir = (integration: string, jobId: string) => ensureDir(path.join(workRoot(integration), jobId))

export function mediaUrl(absPath: string) {
  const rel = path.relative(mediaRoot(), absPath)
  return `${MEDIA_SCHEME}://${MEDIA_HOST}/${rel.split(path.sep).map(encodeURIComponent).join('/')}`
}

/** URL for any file on disk (the protocol only serves it once it's been allowed). */
export const fileUrl = (absPath: string) => `${MEDIA_SCHEME}://${FILE_HOST}/${encodeURIComponent(path.resolve(absPath))}`

// Paths the editor may read: files the user imported or that an opened project references.
const allowed = new Set<string>()
const key = (abs: string) => (process.platform === 'win32' ? path.resolve(abs).toLowerCase() : path.resolve(abs))

export function allowPath(abs: string) {
  allowed.add(key(abs))
}

export function isInside(abs: string, root: string) {
  const a = key(abs)
  const r = key(root)
  return a === r || a.startsWith(r.endsWith(path.sep) ? r : r + path.sep)
}

/** Maps a lumen-media URL back to a file: library files, or user files the editor was given. */
export function mediaPath(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== `${MEDIA_SCHEME}:`) return null
  if (parsed.hostname === MEDIA_HOST) {
    const rel = decodeURIComponent(parsed.pathname).replace(/^\/+/, '')
    const root = mediaRoot()
    const abs = path.resolve(root, rel)
    return abs.startsWith(root + path.sep) ? abs : null
  }
  if (parsed.hostname === FILE_HOST) {
    const abs = path.resolve(decodeURIComponent(parsed.pathname.replace(/^\/+/, '')))
    if (allowed.has(key(abs)) || isInside(abs, mediaRoot())) return abs
    // Frames of an allowed image sequence live in an allowed folder.
    if (allowed.has(key(path.dirname(abs)))) return abs
    return null
  }
  return null
}

/** Waits without giving the thread back: what is written here is small, and its callers don't wait for anything. */
const pause = (ms: number) => void Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

/**
 * Writes a file so that it is the old one or the new one, never a piece of
 * either: the content goes to a file beside it, is flushed to the disk, and
 * takes the name in one step. A crash or a power cut part-way leaves the old
 * file as it was.
 */
export function writeFileAtomic(file: string, data: string | Uint8Array) {
  ensureDir(path.dirname(file))
  const tmp = `${file}.${process.pid}.tmp`
  try {
    const fd = fs.openSync(tmp, 'w')
    try {
      fs.writeFileSync(fd, data)
      try {
        fs.fsyncSync(fd)
      } catch {
        // Not every file system can be told to flush (some network shares): the rename is still all-or-nothing.
      }
    } finally {
      fs.closeSync(fd)
    }
    for (let attempt = 0; ; attempt++) {
      try {
        fs.renameSync(tmp, file)
        return
      } catch (err) {
        // On Windows, a virus scanner or the search indexer reading the old file makes the rename fail for a moment.
        const code = (err as NodeJS.ErrnoException).code
        if (attempt >= 4 || (code !== 'EPERM' && code !== 'EACCES' && code !== 'EBUSY')) throw err
        pause(20 * (attempt + 1))
      }
    }
  } catch (err) {
    fs.rmSync(tmp, { force: true })
    throw err
  }
}

/**
 * Sets aside a file that is there but can't be read, as `<name>.unreadable`,
 * before something is written in its place: whatever it held (a list of
 * servers, a token) can still be looked at, or put back by hand. `fresh` says
 * this is the first time this damaged file was seen.
 */
export function keepUnreadable(file: string): { path: string; fresh: boolean } | null {
  const copy = `${file}.unreadable`
  try {
    const bytes = fs.readFileSync(file)
    if (!bytes.length) return null
    const fresh = !fs.existsSync(copy) || !fs.readFileSync(copy).equals(bytes)
    if (fresh) fs.writeFileSync(copy, bytes)
    return { path: copy, fresh }
  } catch {
    return null
  }
}

const warned = new Set<string>()

/** JSON settings file in userData (integration paths, MCP servers…). */
export function readJson<T>(name: string, fallback: T): T {
  const file = path.join(userDir(), name)
  let text: string
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    // Not there yet.
    return fallback
  }
  try {
    return JSON.parse(text) as T
  } catch {
    // Damaged. The defaults take over, and the next change is written over it — so what it held is kept beside it.
    if (!warned.has(file)) {
      warned.add(file)
      const copy = keepUnreadable(file)
      console.warn(`${name} can’t be read; the defaults are used.${copy ? ` What it held is kept in ${copy.path}.` : ''}`)
    }
    return fallback
  }
}

export function writeJson(name: string, value: unknown) {
  writeFileAtomic(path.join(userDir(), name), JSON.stringify(value, null, 2))
}

const require = createRequire(import.meta.url)

/** Absolute path of a file inside an installed package (works in dev and packaged builds). */
export function packageFile(pkg: string, file: string) {
  const root = path.dirname(require.resolve(`${pkg}/package.json`))
  return path.join(root, file)
}
