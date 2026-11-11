import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { net, shell } from 'electron'
import type { GeneratedAsset, Provenance } from '../../shared/integrations'
import { ensureDir, mediaPath, mediaRoot, mediaUrl } from './paths'
import { checkUrl, isCancelledRedirect, redirectTarget } from './web'

/** Saving generated media (inline tool results, downloads) into Lumen's library folder. */

const EXT: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/avif': '.avif',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
  'audio/mpeg': '.mp3',
  'audio/mp3': '.mp3',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'audio/ogg': '.ogg',
  'audio/mp4': '.m4a',
  'audio/aac': '.aac',
  'audio/flac': '.flac',
}

const MIME_BY_EXT: Record<string, string> = Object.fromEntries(Object.entries(EXT).map(([mime, ext]) => [ext, mime]))
Object.assign(MIME_BY_EXT, { '.jpeg': 'image/jpeg', '.m4v': 'video/mp4' })

export const MEDIA_URL_RE = /https?:\/\/[^\s"'<>()]+?\.(?:png|jpe?g|webp|gif|avif|mp4|webm|mov|m4v|mp3|wav|ogg|m4a|aac|flac)(?:\?[^\s"'<>()]*)?(?=[\s"'<>(),]|$)/gi

export function kindOf(mime: string): GeneratedAsset['kind'] | null {
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  return null
}

export function mimeFromName(name: string) {
  return MIME_BY_EXT[path.extname(name.split('?')[0]).toLowerCase()]
}

const cleanName = (name: string) => name.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[_-]+/g, ' ').trim().slice(0, 60) || 'Generated media'

function fileAsset(abs: string, mime: string, name: string, provenance: Provenance): GeneratedAsset {
  const kind = kindOf(mime)
  if (!kind) throw new Error(`Unsupported media type: ${mime}`)
  return {
    name: cleanName(name),
    kind,
    source: { type: 'file', url: mediaUrl(abs), path: abs, mime, fileName: path.basename(abs), size: fs.statSync(abs).size },
    provenance,
  }
}

/** Writes base64 media from a tool result to disk. */
export function saveBase64(data: string, mime: string, name: string, provenance: Provenance): GeneratedAsset {
  const dir = ensureDir(path.join(mediaRoot(), 'mcp'))
  const abs = path.join(dir, `${randomUUID()}${EXT[mime] ?? ''}`)
  fs.writeFileSync(abs, Buffer.from(data, 'base64'))
  return fileAsset(abs, mime, name, provenance)
}

/** What a download may take: its size, how long the server has to answer, and how long it may send nothing. */
export const IMPORT_LIMITS = { bytes: 4 * 1024 ** 3, answerMs: 30_000, stallMs: 60_000 }

const gigabytes = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(bytes >= 10 * 1024 ** 3 ? 0 : 1)} GB`
const TOO_BIG = (bytes?: number) => `That file is ${bytes ? gigabytes(bytes) : 'too large'} — a link can bring in at most ${gigabytes(IMPORT_LIMITS.bytes)}.`

interface Download {
  url: URL
  res: Response
  /** Ends the request, whatever it is doing. */
  stop: AbortController
  /** Starts (or restarts) the clock on the request: it is ended when `ms` pass. */
  allow(ms: number): void
  settle(): void
}

/**
 * Asks for the file. A link the user picked is followed as given. One the
 * Copilot or an agent chose may only lead to public addresses — what is on
 * this computer or the local network (a router, a NAS, a cloud metadata
 * service) is not theirs to fetch — so each redirect is checked before it is
 * followed.
 */
async function request(raw: string, local: boolean): Promise<Download> {
  const stop = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const allow = (ms: number) => {
    clearTimeout(timer)
    timer = setTimeout(() => stop.abort(), ms)
    timer.unref?.()
  }
  const settle = () => clearTimeout(timer)
  const failed = (url: URL, err: unknown) => {
    settle()
    return new Error(stop.signal.aborted ? `${url.hostname} took too long to answer.` : `Download failed${err instanceof Error && err.message ? ` (${err.message})` : ''}`)
  }
  let url = new URL(raw)
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Only web URLs can be imported.')
  if (local) {
    allow(IMPORT_LIMITS.answerMs)
    const res = await net.fetch(url.href, { signal: stop.signal }).catch((err: unknown) => {
      throw failed(url, err)
    })
    return { url, res, stop, allow, settle }
  }
  url = await checkUrl(url.href)
  for (let hop = 0; hop < 6; hop++) {
    allow(IMPORT_LIMITS.answerMs)
    let res: Response
    try {
      res = await net.fetch(url.href, { redirect: 'manual', signal: stop.signal })
    } catch (err) {
      // Electron's fetch, told not to follow a redirect, fails without saying where it led.
      const to = isCancelledRedirect(err) ? await redirectTarget(url, {}, IMPORT_LIMITS.answerMs) : null
      if (!to) throw failed(url, err)
      url = await checkUrl(new URL(to, url).href)
      continue
    }
    const location = res.headers.get('location')
    if (res.status >= 300 && res.status < 400 && location) {
      void res.body?.cancel().catch(() => {})
      url = await checkUrl(new URL(location, url).href)
      continue
    }
    return { url, res, stop, allow, settle }
  }
  settle()
  throw new Error('Too many redirects.')
}

/**
 * Downloads remote media (e.g. a video URL a generation service returned).
 * `local` says the user picked the link themselves, which lets it lead to this
 * computer or the local network (a generation service running here).
 */
export async function importUrl(url: string, name: string | undefined, provenance: Provenance, opts: { local?: boolean } = {}): Promise<GeneratedAsset> {
  const parsed = new URL(url)
  const { res, stop, allow, settle } = await request(url, opts.local === true)
  const refuse = (message: string) => {
    settle()
    stop.abort()
    return new Error(message)
  }
  if (!res.ok || !res.body) throw refuse(`Download failed (${res.status})`)
  const headerMime = res.headers.get('content-type')?.split(';')[0].trim().toLowerCase()
  const mime = headerMime && kindOf(headerMime) ? headerMime : mimeFromName(parsed.pathname)
  if (!mime || !kindOf(mime)) throw refuse('That link isn’t an image, video or audio file.')
  const declared = Number(res.headers.get('content-length'))
  if (declared > IMPORT_LIMITS.bytes) throw refuse(TOO_BIG(declared))
  const dir = ensureDir(path.join(mediaRoot(), 'imports'))
  // The address ends in whatever its author liked: only a plain extension becomes part of a file name.
  const fromPath = path.extname(parsed.pathname)
  const abs = path.join(dir, `${randomUUID()}${EXT[mime] ?? (/^\.[a-z0-9]{1,8}$/i.test(fromPath) ? fromPath : '')}`)
  // Written beside its final name and moved there once whole: a download that fails leaves nothing in the library.
  const part = `${abs}.part`
  let size = 0
  let tooBig = false
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      size += chunk.length
      if (size > IMPORT_LIMITS.bytes) {
        tooBig = true
        return done(new Error(TOO_BIG()))
      }
      // Still arriving: the clock is on the silence between two pieces, not on the whole download.
      allow(IMPORT_LIMITS.stallMs)
      done(null, chunk)
    },
  })
  try {
    allow(IMPORT_LIMITS.stallMs)
    await pipeline(Readable.fromWeb(res.body as import('node:stream/web').ReadableStream), meter, fs.createWriteStream(part), { signal: stop.signal })
    fs.renameSync(part, abs)
  } catch (err) {
    const stalled = stop.signal.aborted && !tooBig
    stop.abort()
    fs.rmSync(part, { force: true })
    if (stalled) throw new Error(`The download stopped: nothing arrived for ${Math.round(IMPORT_LIMITS.stallMs / 1000)} seconds.`)
    throw err
  } finally {
    settle()
  }
  return fileAsset(abs, mime, name ?? decodeURIComponent(path.basename(parsed.pathname)), provenance)
}

export function reveal(url: string) {
  const abs = mediaPath(url)
  if (abs) shell.showItemInFolder(abs)
}
