import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

// No network here: Electron's fetch is a script each test writes, and every name resolves to a public address.
const env = vi.hoisted(() => ({ root: '', answer: (_url: URL): Response => new Response('not scripted', { status: 500 }) }))

vi.mock('electron', () => ({
  app: { getPath: (name: string) => `${env.root}/${name}` },
  shell: {},
  net: { fetch: async (url: string) => env.answer(new URL(url)) },
  nativeImage: {},
  session: {},
  BrowserWindow: class {},
  screen: {},
}))
vi.mock('node:dns/promises', () => ({ lookup: async () => [{ address: '93.184.216.34', family: 4 }] }))

env.root = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-media-redirect-test-')).replace(/\\/g, '/')
const { importUrl } = await import('./media')
const imports = path.join(env.root, 'userData', 'media', 'imports')
const stored = () => (fs.existsSync(imports) ? fs.readdirSync(imports) : [])
const BY_AGENT = { integration: 'agent', tool: 'import_media_url' }

afterAll(() => fs.rmSync(env.root, { recursive: true, force: true }))
beforeEach(() => fs.rmSync(imports, { recursive: true, force: true }))

const moved = (to: string) => new Response(null, { status: 302, headers: { location: to } })
/** A file sent the way a download is: as bytes, without saying what they are. */
const bytes = (type = 'application/octet-stream') => new Response(new Uint8Array(1500), { headers: { 'content-type': type } })

describe('a link that leads on to the media file', () => {
  it('is taken for what the address it leads to says, when the answer doesn’t say', async () => {
    // A short link, or a "download" address, that leads on to …/sunset_final.mp4 sent as plain bytes. What the file
    // is was read from the link itself — which says nothing — and it was refused: "isn’t an image, video or audio
    // file".
    env.answer = (url) => (url.hostname === 'short.example.com' ? moved('https://files.example.com/renders/sunset_final.mp4?sig=abc') : bytes())
    const asset = await importUrl('https://short.example.com/x7Gq', undefined, BY_AGENT)
    expect(asset).toMatchObject({ kind: 'video', name: 'sunset final', source: { mime: 'video/mp4', size: 1500 } })
    expect(stored()).toHaveLength(1)
    expect(stored()[0]).toMatch(/^[0-9a-f-]{36}\.mp4$/)
  })

  it('is named after the file it leads to', async () => {
    env.answer = (url) => (url.hostname === 'short.example.com' ? moved('https://files.example.com/renders/sunset_final.png') : bytes('image/png'))
    // It was called "x7Gq".
    expect((await importUrl('https://short.example.com/x7Gq', undefined, BY_AGENT)).name).toBe('sunset final')
    // A name that was given is the name.
    expect((await importUrl('https://short.example.com/x7Gq', 'Sunset', BY_AGENT)).name).toBe('Sunset')
  })

  it('is still taken for what the link itself says, when where it leads says nothing', async () => {
    // A release's file: its own address names it, the store it is kept in doesn't.
    env.answer = (url) => (url.hostname === 'code.example.com' ? moved('https://objects.example.net/store/9f2c41d0?X-Sig=abc') : bytes())
    const asset = await importUrl('https://code.example.com/releases/v2/trailer_cut.mp4', undefined, BY_AGENT)
    expect(asset).toMatchObject({ kind: 'video', name: 'trailer cut', source: { mime: 'video/mp4' } })
  })

  it('is refused when neither says what it is', async () => {
    env.answer = (url) => (url.hostname === 'short.example.com' ? moved('https://files.example.com/download/9f2c41d0') : bytes())
    await expect(importUrl('https://short.example.com/x7Gq', undefined, BY_AGENT)).rejects.toThrow(/isn’t an image, video or audio file/)
    expect(stored()).toEqual([])
  })
})
