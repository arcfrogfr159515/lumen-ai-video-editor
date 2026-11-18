import { describe, expect, it, vi } from 'vitest'

// No network here: the web answers with the bytes each test gives it.
const env = vi.hoisted(() => ({ page: (_url: string): Response => new Response('not scripted', { status: 500 }) }))
vi.mock('electron', () => ({
  net: { fetch: async (url: string) => env.page(url) },
  nativeImage: {},
  session: {},
  BrowserWindow: class {},
  screen: {},
}))
vi.mock('node:dns/promises', () => ({ lookup: async () => [{ address: '93.184.216.34', family: 4 }] }))

const { linkPreview, readPage } = await import('./web')

// The same words as each encoding writes them. (In UTF-8, 中文 is e4 b8 ad e6 96 87.)
const GBK = [0xd6, 0xd0, 0xce, 0xc4] // 中文
const SHIFT_JIS = [0x93, 0xfa, 0x96, 0x7b, 0x8c, 0xea] // 日本語
const WINDOWS_1251 = [0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2] // Привет

/** A page whose title and first paragraph are `words`, written in whatever bytes are given. */
function page(words: number[] | string, type: string | null, head = '') {
  const w = typeof words === 'string' ? Buffer.from(words, 'utf8') : Buffer.from(words)
  // Everything around the words is plain letters, the same bytes in each of these encodings.
  const part = (s: string) => Buffer.from(s, 'latin1')
  const bytes = Buffer.concat([part(`<html><head>${head}<title>`), w, part('</title></head><body><p>'), w, part(' is what this page is about.</p></body></html>')])
  return () => new Response(bytes, { headers: type === null ? {} : { 'content-type': type } })
}

describe('a page that isn’t written in UTF-8', () => {
  it('is read in the encoding its address answers with', async () => {
    // Every page was read as UTF-8, whatever it said it was written in: a page in GBK — as many Chinese sites are —
    // gave the Copilot a title and a text of "����".
    env.page = page(GBK, 'text/html; charset=GBK')
    const read = await readPage('https://example.cn/news')
    expect(read.title).toBe('中文')
    expect(read.text).toContain('中文 is what this page is about.')
  })

  it('is read in the encoding it names itself, where the answer names none', async () => {
    env.page = page(GBK, 'text/html', '<meta charset="gb2312">')
    expect((await readPage('https://example.cn/a')).title).toBe('中文')
    env.page = page(SHIFT_JIS, 'text/html', '<meta http-equiv="Content-Type" content="text/html; charset=Shift_JIS">')
    expect((await readPage('https://example.jp/a')).title).toBe('日本語')
    env.page = page(WINDOWS_1251, 'text/html', "<meta charset='windows-1251'>")
    expect((await readPage('https://example.ru/a')).title).toBe('Привет')
    env.page = page(GBK, 'text/html', '<meta charset=gbk>')
    expect((await readPage('https://example.cn/b')).title).toBe('中文')
  })

  it('goes by what the answer says, over what the page says of itself', async () => {
    // A server that converts a page as it sends it leaves the page's own note as it was.
    env.page = page('中文', 'text/html; charset=utf-8', '<meta charset="gbk">')
    expect((await readPage('https://example.cn/c')).title).toBe('中文')
  })

  it('has its card under a reply in its own words too', async () => {
    env.page = page(GBK, 'text/html; charset=gb18030', '<meta property="og:site_name" content="Example">')
    expect((await linkPreview('https://example.cn/card')).title).toBe('中文')
  })

  it('is read as text that isn’t a page, in the encoding the answer names', async () => {
    env.page = () => new Response(Buffer.from(GBK), { headers: { 'content-type': 'text/plain; charset=gbk' } })
    expect((await readPage('https://example.cn/notes.txt')).text).toBe('中文')
  })
})

describe('a page written in UTF-8', () => {
  it('is read as before, whether or not it says so', async () => {
    env.page = page('中文', 'text/html; charset=utf-8')
    expect((await readPage('https://example.com/a')).title).toBe('中文')
    env.page = page('中文', 'text/html', '<meta charset="utf-8">')
    expect((await readPage('https://example.com/b')).title).toBe('中文')
    env.page = page('中文', 'text/html')
    expect((await readPage('https://example.com/c')).title).toBe('中文')
  })

  it('is read as UTF-8 when it names an encoding nobody knows, or one it can’t be in', async () => {
    env.page = page('中文', 'text/html; charset=klingon')
    expect((await readPage('https://example.com/d')).title).toBe('中文')
    // A page whose own note could be read byte by byte isn’t in UTF-16, whatever the note says.
    env.page = page('中文', 'text/html', '<meta charset="utf-16">')
    expect((await readPage('https://example.com/e')).title).toBe('中文')
  })
})
