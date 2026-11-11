import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

// No network here: Electron's fetch is a script each test writes, and names resolve to whatever the test says.
type Call = { url: string; redirect?: string }
const env = vi.hoisted(() => ({
  root: '',
  calls: [] as Call[],
  asElectron: false,
  resolves: [{ address: '93.184.216.34', family: 4 }],
  answer: (_url: URL, _signal?: AbortSignal): Response | Promise<Response> => new Response('not scripted', { status: 500 }),
}))
const redirects = (res: Response) => (res.status >= 300 && res.status < 400 ? res.headers.get('location') : null)

vi.mock('electron', () => ({
  app: { getPath: (name: string) => `${env.root}/${name}` },
  shell: {},
  net: {
    fetch: async (url: string, init: RequestInit = {}) => {
      env.calls.push({ url, redirect: init.redirect })
      const res = await env.answer(new URL(url), init.signal ?? undefined)
      // Electron's fetch, told not to follow a redirect, fails without saying where it led.
      if (env.asElectron && init.redirect === 'manual' && redirects(res)) throw new Error('Redirect was cancelled')
      return res
    },
    request: (opts: { url: string }) => {
      const on: Record<string, (...args: unknown[]) => void> = {}
      return {
        setHeader: () => {},
        on: (event: string, fn: (...args: unknown[]) => void) => void (on[event] = fn),
        abort: () => {},
        end: () => {
          void Promise.resolve(env.answer(new URL(opts.url))).then((res) => {
            const to = redirects(res)
            if (to) on.redirect?.(res.status, 'GET', new URL(to, opts.url).href, {})
            else on.response?.({ statusCode: res.status })
          })
        },
      }
    },
  },
  nativeImage: {},
  session: {},
  BrowserWindow: class {},
  screen: {},
}))
vi.mock('node:dns/promises', () => ({ lookup: async () => env.resolves }))

env.root = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-media-test-')).replace(/\\/g, '/')
const { importUrl, IMPORT_LIMITS } = await import('./media')
const imports = path.join(env.root, 'userData', 'media', 'imports')
const stored = () => (fs.existsSync(imports) ? fs.readdirSync(imports) : [])
const limits = { ...IMPORT_LIMITS }
const BY_AGENT = { integration: 'agent', tool: 'import_media_url' }

afterAll(() => fs.rmSync(env.root, { recursive: true, force: true }))
beforeEach(() => {
  env.calls.length = 0
  env.asElectron = false
  env.resolves = [{ address: '93.184.216.34', family: 4 }]
  env.answer = () => new Response('not scripted', { status: 500 })
  Object.assign(IMPORT_LIMITS, limits)
  fs.rmSync(imports, { recursive: true, force: true })
})

const png = (bytes = 2000, headers: Record<string, string> = {}) => new Response(new Uint8Array(bytes), { headers: { 'content-type': 'image/png', ...headers } })
const moved = (to: string) => new Response(null, { status: 302, headers: { location: to } })
/** A body that sends `pieces` of 1000 bytes and then does `after`: goes quiet for good, or breaks. */
function body(pieces: number, after: 'stall' | 'break' | 'end' = 'end') {
  let sent = 0
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent++ < pieces) return controller.enqueue(new Uint8Array(1000))
      if (after === 'end') return controller.close()
      if (after === 'break') return controller.error(new Error('The connection was reset.'))
      return new Promise<void>(() => {})
    },
  })
}

describe('importing media by link', () => {
  it('saves the file and says what it is', async () => {
    env.answer = () => png(2000)
    const asset = await importUrl('https://cdn.example.com/renders/sunset_final.png?sig=abc', undefined, BY_AGENT)
    expect(asset).toMatchObject({ name: 'sunset final', kind: 'image', provenance: BY_AGENT, source: { type: 'file', mime: 'image/png', size: 2000 } })
    expect(stored()).toHaveLength(1)
    expect(stored()[0]).toMatch(/^[0-9a-f-]{36}\.png$/)
  })

  it('refuses a link the Copilot chose that leads to this computer or the local network, without asking for it', async () => {
    const local = [
      'http://127.0.0.1:8188/view/out.png',
      'http://[::1]/out.png',
      'http://[::ffff:127.0.0.1]/out.png',
      'http://localhost./out.png',
      'http://192.168.1.1/snapshot.jpg',
      'http://169.254.169.254/latest/meta-data/iam.png',
      'http://nas.local/films/a.mp4',
    ]
    for (const url of local) await expect(importUrl(url, undefined, BY_AGENT), url).rejects.toThrow(/off limits/)
    expect(env.calls).toEqual([])
    expect(stored()).toEqual([])
  })

  it('refuses a public name that points into the local network', async () => {
    env.resolves = [{ address: '10.0.0.5', family: 4 }]
    await expect(importUrl('https://innocent.example.com/a.png', undefined, BY_AGENT)).rejects.toThrow(/points into the local network/)
    expect(env.calls).toEqual([])
  })

  it('checks where a redirect leads before following it', async () => {
    for (const asElectron of [false, true]) {
      env.calls.length = 0
      env.asElectron = asElectron
      env.answer = (url) => (url.hostname === 'cdn.example.com' ? moved('http://127.0.0.1:7890/secret.png') : png())
      await expect(importUrl('https://cdn.example.com/a.png', undefined, BY_AGENT)).rejects.toThrow(/off limits/)
      // The local address was never asked for.
      expect(env.calls.map((c) => new URL(c.url).hostname)).toEqual(['cdn.example.com'])
      expect(env.calls[0].redirect).toBe('manual')
      expect(stored()).toEqual([])
    }
  })

  it('follows a redirect to another public address', async () => {
    for (const asElectron of [false, true]) {
      env.asElectron = asElectron
      env.answer = (url) => (url.hostname === 'short.example.com' ? moved('https://files.example.com/a.png') : png(500))
      const asset = await importUrl('https://short.example.com/x', 'A picture', BY_AGENT)
      expect(asset.source).toMatchObject({ mime: 'image/png', size: 500 })
    }
    await expect(
      (async () => {
        env.answer = (url) => moved(`https://loop.example.com/${Number(url.pathname.slice(1)) + 1}`)
        await importUrl('https://loop.example.com/0', undefined, BY_AGENT)
      })(),
    ).rejects.toThrow(/Too many redirects/)
  })

  it('lets a link the user picked lead to this computer', async () => {
    env.answer = () => png(1200)
    const asset = await importUrl('http://127.0.0.1:8188/view/out.png', undefined, { integration: 'comfyui', tool: 'generate' }, { local: true })
    expect(asset.source).toMatchObject({ size: 1200 })
    expect(env.calls).toEqual([{ url: 'http://127.0.0.1:8188/view/out.png', redirect: undefined }])
  })

  it('refuses what isn’t media or isn’t on the web', async () => {
    env.answer = () => new Response('<html></html>', { headers: { 'content-type': 'text/html' } })
    await expect(importUrl('https://example.com/page', undefined, BY_AGENT)).rejects.toThrow(/isn’t an image, video or audio file/)
    await expect(importUrl('file:///C:/Windows/win.ini', undefined, BY_AGENT, { local: true })).rejects.toThrow(/Only web URLs/)
    env.answer = () => new Response('gone', { status: 404 })
    await expect(importUrl('https://example.com/a.png', undefined, BY_AGENT)).rejects.toThrow(/Download failed \(404\)/)
    expect(stored()).toEqual([])
  })

  it('refuses a file that says it is larger than a link may bring in', async () => {
    IMPORT_LIMITS.bytes = 5000
    env.answer = () => new Response(body(1), { headers: { 'content-type': 'video/mp4', 'content-length': '6000' } })
    await expect(importUrl('https://example.com/big.mp4', undefined, BY_AGENT)).rejects.toThrow(/at most/)
    expect(stored()).toEqual([])
  })

  it('stops a file that turns out larger than it said, and leaves nothing behind', async () => {
    IMPORT_LIMITS.bytes = 5000
    env.answer = () => new Response(body(50), { headers: { 'content-type': 'video/mp4' } })
    await expect(importUrl('https://example.com/endless.mp4', undefined, BY_AGENT)).rejects.toThrow(/at most/)
    expect(stored()).toEqual([])
  })

  it('gives up on a server that never answers', async () => {
    IMPORT_LIMITS.answerMs = 40
    env.answer = (_url, signal) => new Promise((_resolve, reject) => signal?.addEventListener('abort', () => reject(new Error('aborted'))))
    await expect(importUrl('https://slow.example.com/a.png', undefined, BY_AGENT)).rejects.toThrow(/slow\.example\.com took too long to answer/)
    await expect(importUrl('http://127.0.0.1:9/a.png', undefined, BY_AGENT, { local: true })).rejects.toThrow(/took too long to answer/)
    expect(stored()).toEqual([])
  })

  it('gives up on a download that goes quiet, and leaves nothing behind', async () => {
    IMPORT_LIMITS.stallMs = 60
    env.answer = () => new Response(body(3, 'stall'), { headers: { 'content-type': 'video/mp4' } })
    await expect(importUrl('https://example.com/stalls.mp4', undefined, BY_AGENT)).rejects.toThrow(/nothing arrived/)
    expect(stored()).toEqual([])
  })

  it('leaves nothing behind when the connection breaks part-way', async () => {
    env.answer = () => new Response(body(3, 'break'), { headers: { 'content-type': 'audio/mpeg' } })
    await expect(importUrl('https://example.com/song.mp3', undefined, BY_AGENT)).rejects.toThrow(/connection was reset/)
    expect(stored()).toEqual([])
  })

  it('takes only a plain extension from the address into the file name', async () => {
    env.answer = () => new Response(new Uint8Array(10), { headers: { 'content-type': 'image/bmp' } })
    await importUrl('https://example.com/a.bmp', undefined, BY_AGENT)
    await importUrl('https://example.com/a.b:evil', undefined, BY_AGENT)
    const names = stored().sort((a, b) => a.length - b.length)
    expect(names[0]).toMatch(/^[0-9a-f-]{36}$/)
    expect(names[1]).toMatch(/^[0-9a-f-]{36}\.bmp$/)
  })
})
