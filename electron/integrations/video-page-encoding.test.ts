import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'

// No network here: the web answers with the bytes each test gives it, and every name resolves to a public address.
const env = vi.hoisted(() => ({ root: '', answer: (_url: URL): Response => new Response('not scripted', { status: 500 }) }))
vi.mock('electron', () => ({
  app: { getPath: (name: string) => `${env.root}/${name}`, once: () => {} },
  net: { fetch: async (url: string) => env.answer(new URL(url)) },
  nativeImage: {},
  session: {},
  BrowserWindow: class {},
  screen: {},
}))
vi.mock('node:dns/promises', () => ({ lookup: async () => [{ address: '93.184.216.34', family: 4 }] }))

env.root = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-watch-encoding-test-')).replace(/\\/g, '/')
// yt-dlp is never found here, whatever is installed on the machine running the tests.
const realPath = process.env.PATH
process.env.PATH = ''
const { watchVideo } = await import('./video-link')

afterAll(() => {
  process.env.PATH = realPath
  fs.rmSync(env.root, { recursive: true, force: true })
})

// The same words as each encoding writes them.
const GBK = [0xd6, 0xd0, 0xce, 0xc4] // 中文
const SHIFT_JIS = [0x93, 0xfa, 0x96, 0x7b, 0x8c, 0xea] // 日本語

/** A page about a video, its title and its description `words`, written in whatever bytes are given. */
function page(words: number[] | string, type: string | null, head = '') {
  const w = typeof words === 'string' ? Buffer.from(words, 'utf8') : Buffer.from(words)
  // Everything around the words is plain letters, the same bytes in each of these encodings.
  const part = (s: string) => Buffer.from(s, 'latin1')
  const bytes = Buffer.concat([part(`<html><head>${head}<title>`), w, part('</title><meta property="og:type" content="video.other"><meta name="description" content="'), w, part('"></head><body></body></html>')])
  return () => new Response(bytes, { headers: type === null ? {} : { 'content-type': type } })
}

describe('a page with a video on it that isn’t written in UTF-8', () => {
  it('is read in the encoding its address answers with', async () => {
    // The page was read as UTF-8 whatever it said it was written in: a video on a site in GBK was called "����",
    // and described the same way.
    env.answer = page(GBK, 'text/html; charset=GBK')
    const video = await watchVideo('https://93.184.216.34/v/1')
    expect(video.title).toBe('中文')
    expect(video.description).toBe('中文')
  })

  it('is read in the encoding it names itself, where the answer names none', async () => {
    env.answer = page(GBK, 'text/html', '<meta charset="gb2312">')
    expect((await watchVideo('https://93.184.216.34/v/2')).title).toBe('中文')
    env.answer = page(SHIFT_JIS, 'text/html', '<meta http-equiv="Content-Type" content="text/html; charset=Shift_JIS">')
    expect((await watchVideo('https://93.184.216.34/v/3')).title).toBe('日本語')
    // And where the answer doesn't even say what it is.
    env.answer = page(GBK, null, '<meta charset=gbk>')
    expect((await watchVideo('https://93.184.216.34/v/4')).title).toBe('中文')
  })
})

describe('a page with a video on it, written in UTF-8', () => {
  it('is read as before, whether or not it says so', async () => {
    env.answer = page('中文', 'text/html; charset=utf-8')
    expect((await watchVideo('https://93.184.216.34/v/5')).title).toBe('中文')
    env.answer = page('中文', 'text/html')
    expect((await watchVideo('https://93.184.216.34/v/6')).title).toBe('中文')
    env.answer = page('中文', null)
    expect((await watchVideo('https://93.184.216.34/v/7')).title).toBe('中文')
  })
})
