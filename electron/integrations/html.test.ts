import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => 'x', once: () => {} }, net: {}, nativeImage: {}, session: {}, BrowserWindow: class {}, screen: {} }))
const { dropElements, elements, firstElement, stripComments, tidyTags } = await import('./html')
const web = await import('./web')
const video = await import('./video-link')

// ─── What these replaced, kept here to compare against: the readers as they were. ───
const legacy = {
  meta(html: string, name: string) {
    const tag = new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]*>`, 'i').exec(html)?.[0]
    const content = tag && /content=["']([^"']*)["']/i.exec(tag)?.[1]
    return content ? web.decodeEntities(content).trim() : undefined
  },
  readable(html: string) {
    let body = html.replace(/<!--[\s\S]*?-->/g, '')
    const main = /<article[\s\S]*?<\/article>/i.exec(body)?.[0] ?? /<main[\s\S]*?<\/main>/i.exec(body)?.[0]
    if (main && main.length > 400) body = main
    body = body
      .replace(/<(script|style|noscript|svg|template|iframe|form|nav|footer|header|aside)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<(br|hr)\s*\/?>/gi, '\n')
      .replace(/<li[^>]*>/gi, '\n• ')
      .replace(/<\/(p|div|section|h[1-6]|li|tr|blockquote|pre|table|ul|ol)>/gi, '\n')
      .replace(/<h([1-6])[^>]*>/gi, (_m, n: string) => `\n${'#'.repeat(Number(n))} `)
      .replace(/<[^>]+>/g, ' ')
    return web
      .decodeEntities(body)
      .replace(/[ \t\f\v]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/^•\s*$/gm, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  },
  strip: (s: string) => web.decodeEntities(s.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim(),
}

// ─── Pages as sites write them: well formed, of every shape. ───
function pages(count: number) {
  let seed = 20261111
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
  const pick = <T,>(list: readonly T[]) => list[Math.floor(rnd() * list.length)]
  const words = ['Lumen', 'edits', 'video', 'quickly', 'and', 'the', 'timeline', 'shows', 'every', 'cut', 'R&amp;D', '5&nbsp;px', 'caf&eacute;', '&#8212;', 'a &lt; b', 'x &gt; y', '“quoted”', '日本語']
  const text = (n: number) => Array.from({ length: n }, () => pick(words)).join(' ')
  const attr = () => pick(['', ' class="lead"', ' id="x1" data-n="3"', ' title="a > b"', " style='color:red'", ' hidden'])
  const inline = () => pick([text(4), `<b${attr()}>${text(2)}</b>`, `<a href="https://example.com/${Math.floor(rnd() * 99)}"${attr()}>${text(3)}</a>`, `<span${attr()}>${text(2)}</span>`, `${text(2)}<br>${text(2)}`, `<img src="/i/${Math.floor(rnd() * 9)}.png" alt="${text(1)}">`, `<code>${text(1)}</code>`])
  const block = (): string =>
    pick([
      () => `<p${attr()}>${inline()} ${inline()}</p>`,
      () => `<h${1 + Math.floor(rnd() * 6)}${attr()}>${text(3)}</h${1 + Math.floor(rnd() * 6)}>`,
      () => `<ul>${Array.from({ length: 1 + Math.floor(rnd() * 4) }, () => `<li${attr()}>${inline()}</li>`).join('')}</ul>`,
      () => `<div${attr()}>${block()}${block()}</div>`,
      () => `<script${pick(['', ' type="text/javascript"', ' async'])}>var a = 1; if (a) { document.title = "x" }</script>`,
      () => `<style>p { color: red } a > b { margin: 0 }</style>`,
      () => `<!-- ${text(3)} -->`,
      () => `<nav><a href="/">Home</a> <a href="/about">About</a></nav>`,
      () => `<footer>${text(4)}</footer>`,
      () => `<blockquote>${text(6)}</blockquote><hr/>`,
      () => `<table><tr><td>${text(2)}</td><td>${text(2)}</td></tr></table>`,
      () => `<section><h2>${text(2)}</h2><p>${text(8)}</p></section>`,
      () => `<form action="/s"><input name="q"><button>Go</button></form>`,
      () => `<svg viewBox="0 0 1 1"><path d="M0 0"/></svg>`,
    ])()
  const out: string[] = []
  for (let n = 0; n < count; n++) {
    const body = Array.from({ length: 3 + Math.floor(rnd() * 25) }, block).join('\n')
    const wrapped = pick([body, `<article>${body}</article>`, `<header>Site</header><main>${body}</main>`, `<div id="app">${body}</div>`])
    const metas = [`<meta name="description" content="${text(5)}">`, `<meta property="og:title" content="${text(3)}" />`, `<meta content="${text(2)}" property="og:site_name">`, `<meta charset="utf-8">`, `<meta name="viewport" content="width=device-width">`].filter(() => rnd() > 0.3).join('')
    out.push(`<!doctype html><html><head><title>${text(3)}</title>${metas}</head><body>${wrapped}</body></html>`)
  }
  return out
}

describe('reading a page once through', () => {
  it('turns a "<" that opens nothing into text, and leaves real tags alone', () => {
    expect(tidyTags('<p>a</p>')).toBe('<p>a</p>')
    expect(tidyTags('1 < 2 and <b>bold</b>')).toBe('1 &lt; 2 and <b>bold</b>')
    expect(tidyTags('a << b <i>c</i> <')).toBe('a &lt;&lt; b <i>c</i> &lt;')
    expect(tidyTags('<<<<')).toBe('&lt;&lt;&lt;&lt;')
    expect(tidyTags('no tags > here')).toBe('no tags > here')
    expect(tidyTags('')).toBe('')
    expect(tidyTags('<a title="x > y">t</a>')).toBe('<a title="x > y">t</a>')
  })

  it('finds elements, each ending at the first closing tag, and stops when none is left', () => {
    const html = '<a href="/1">one</a> <abbr>x</abbr> <A HREF="/2" class="k">two <b>2</b></A> <a href="/3">never closed'
    expect([...elements(html, 'a')].map((e) => [e.tag, e.inner])).toEqual([
      ['<a href="/1">', 'one'],
      ['<A HREF="/2" class="k">', 'two <b>2</b>'],
    ])
    expect(firstElement('<head><title>Hello &amp; you</title></head>', 'title')?.inner).toBe('Hello &amp; you')
    expect(firstElement('<title>open', 'title')).toBeNull()
    expect(firstElement('<titles>x</titles>', 'title')).toBeNull()
  })

  it('takes out comments and whole elements', () => {
    expect(stripComments('a<!-- b -->c<!-- d')).toBe('ac<!-- d')
    expect(dropElements('x<script>1</script>y<STYLE>z</STYLE>w<nav>n', ['script', 'style', 'nav'])).toBe('x y w<nav>n')
    expect(dropElements('<script>a</script><script>b', ['script'])).toBe(' <script>b')
  })

  it('reads ordinary pages exactly as before', () => {
    const corpus = pages(250)
    for (const page of corpus) {
      expect(web.readable(page)).toBe(legacy.readable(page))
      expect(web.strip(page)).toBe(legacy.strip(page))
      for (const name of ['description', 'og:title', 'og:site_name', 'viewport', 'nothing']) expect(web.meta(page, name)).toBe(legacy.meta(page, name))
    }
    // The corpus does have what the readers work on.
    expect(corpus.filter((p) => web.meta(p, 'og:title')).length).toBeGreaterThan(50)
    expect(corpus.filter((p) => web.readable(p).includes('•')).length).toBeGreaterThan(50)
    expect(corpus.filter((p) => web.readable(p).includes('#')).length).toBeGreaterThan(50)
  })

  it('keeps the words around a "<" that is only a "<"', () => {
    // The old pattern took "< 2 and <b>" for one tag and dropped the words in it.
    expect(web.strip('1 < 2 and <b>bold</b> text')).toBe('1 < 2 and bold text')
    expect(web.readable('<p>if a < b then <i>stop</i></p>')).toBe('if a < b then stop')
  })

  it('reads search results and video pages as before', () => {
    const results =
      '<div class="result results_links"><h2><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa&amp;rut=1">First <b>hit</b></a></h2><a class="result__snippet" href="x">A <b>snippet</b> here</a></div>' +
      '<div class="result"><a href="https://example.org/b" class="result__a">Second</a><div class="result__snippet">Other text</div></div>' +
      '<div class="result"><a class="result__a" href="https://example.net/c">Third, never closed'
    expect(web.parseSearch(results, 8)).toEqual([
      { title: 'First hit', url: 'https://example.com/a', snippet: 'A snippet here' },
      { title: 'Second', url: 'https://example.org/b', snippet: 'Other text' },
    ])
    const page = '<html><head><title>A film</title><meta property="og:video" content="https://cdn.example.com/v.mp4"><script type="application/ld+json">{"@type":"VideoObject","name":"From LD","duration":"PT1M5S"}</script></head><body><video src="/local.webm"></video><iframe src="https://www.youtube.com/embed/abc"></iframe></body></html>'
    expect(video.parseVideoPage(page, new URL('https://example.com/watch'))).toMatchObject({ title: 'From LD', duration: 65, media: ['https://cdn.example.com/v.mp4', 'https://example.com/local.webm'], embeds: expect.arrayContaining(['https://www.youtube.com/embed/abc']), video: true })
    expect(video.parseCaptionXml('<timedtext><body><p t="1000" d="500">Hello <b>there</b></p><p t="2000" d="400">again</p></body></timedtext>')).toEqual([
      { start: 1, end: 1.5, text: 'Hello there' },
      { start: 2, end: 2.4, text: 'again' },
    ])
  })

  it('takes no longer on a page written to waste time', () => {
    const MB = 1024 * 1024
    const hostile: [string, string, (page: string) => unknown][] = [
      ['strip', '<'.repeat(4 * MB), (p) => web.strip(p)],
      ['readable: "<"', '<'.repeat(4 * MB), (p) => web.readable(p)],
      ['readable: "<script "', '<script '.repeat((4 * MB) / 8), (p) => web.readable(p)],
      ['readable: "<!--"', '<!--'.repeat(MB), (p) => web.readable(p)],
      ['readable: "<article "', '<article '.repeat((4 * MB) / 9), (p) => web.readable(p)],
      ['readable: "<li "', '<li '.repeat(MB), (p) => web.readable(p)],
      ['readable: "<h1 "', '<h1 '.repeat(MB), (p) => web.readable(p)],
      ['meta', '<meta '.repeat((4 * MB) / 6), (p) => web.meta(p, 'og:title')],
      ['parseSearch: "<a "', '<div class="result">' + '<a '.repeat((4 * MB) / 3), (p) => web.parseSearch(p, 8)],
      ['parseSearch: "<div "', '<div '.repeat((4 * MB) / 5), (p) => web.parseSearch(p, 8)],
      ['parseSearch: snippets', '<div class="result"><a class="result__a" href="https://e.com/">t</a>' + '<i class="result__snippet">'.repeat((4 * MB) / 27), (p) => web.parseSearch(p, 8)],
      ['parseVideoPage: "<meta "', '<meta '.repeat((8 * MB) / 6), (p) => video.parseVideoPage(p, new URL('https://example.com/v'))],
      ['parseVideoPage: "<script "', '<script type="application/ld+json">'.repeat((8 * MB) / 35), (p) => video.parseVideoPage(p, new URL('https://example.com/v'))],
      ['parseVideoPage: "<title>"', '<title>'.repeat((8 * MB) / 7), (p) => video.parseVideoPage(p, new URL('https://example.com/v'))],
      ['parseVideoPage: "<video "', '<video '.repeat((8 * MB) / 7), (p) => video.parseVideoPage(p, new URL('https://example.com/v'))],
      ['parseVideoPage: "<link "', '<link '.repeat((8 * MB) / 6), (p) => video.parseVideoPage(p, new URL('https://example.com/v'))],
      ['parseCaptionXml: "<p "', '<p t="1">'.repeat((8 * MB) / 9), (p) => video.parseCaptionXml(p)],
      ['parseVtt: one cue of "<"', '00:00:01.000 --> 00:00:02.000\n' + '<'.repeat(4 * MB), (p) => video.parseVtt(p)],
      ['canonicalYouTubeId', '<link '.repeat((8 * MB) / 6), (p) => video.canonicalYouTubeId(p)],
    ]
    const slow: string[] = []
    for (const [label, page, run] of hostile) {
      const t0 = performance.now()
      run(page)
      const ms = performance.now() - t0
      // Each of these used to take from twelve minutes to over an hour at this size (measured at 256 KB, where they
      // took 3 to 17 s, and growing with the square). Now they take under a second; the limit is set far from both,
      // so that a machine busy with the rest of the tests doesn't trip it (2.7 s was seen once) and the old way would.
      if (ms > 20000) slow.push(`${label}: ${Math.round(ms)} ms`)
    }
    expect(slow).toEqual([])
  }, 400000)
})
