import { beforeEach, describe, expect, it, vi } from 'vitest'

// No network here: names resolve to whatever each test says, and the browsing session keeps the filter it is given.
type Filter = (details: { url: string }, cb: (answer: { cancel?: boolean }) => void) => void
const env = vi.hoisted(() => ({
  resolves: [{ address: '93.184.216.34', family: 4 }] as { address: string; family: number }[],
  /** Where single names lead, for the tests that need several hosts at once. */
  names: {} as Record<string, string>,
  lookups: [] as string[],
  filter: null as Filter | null,
  /** What the web answers a page being read with: each test that reads one says. */
  page: (_url: string): Response => new Response('not scripted', { status: 500 }),
}))
vi.mock('electron', () => ({
  net: { fetch: async (url: string) => env.page(url) },
  nativeImage: {},
  session: {
    fromPartition: () => ({
      setUserAgent: () => {},
      on: () => {},
      setPermissionRequestHandler: () => {},
      webRequest: { onBeforeRequest: (fn: Filter) => void (env.filter = fn) },
    }),
  },
  BrowserWindow: class {},
  screen: {},
}))
vi.mock('node:dns/promises', () => ({
  lookup: async (host: string) => {
    env.lookups.push(host)
    if (env.names[host] === 'nowhere') throw new Error('ENOTFOUND')
    return env.names[host] ? [{ address: env.names[host], family: env.names[host].includes(':') ? 6 : 4 }] : env.resolves
  },
}))

const { blockedHost, blockedIp, browsing, checkUrl, leadsInside, meta, parseSearch, readPage } = await import('./web')

beforeEach(() => {
  env.resolves = [{ address: '93.184.216.34', family: 4 }]
  env.names = {}
  env.lookups.length = 0
})

/** The host of a URL as the browser's own parser hands it over — the form every check here receives. */
const host = (url: string) => new URL(url).hostname

describe('addresses on this computer or the local network', () => {
  it('are refused as IPv4', () => {
    for (const ip of ['127.0.0.1', '127.8.9.10', '0.0.0.0', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '224.0.0.1', '255.255.255.255'])
      expect(blockedIp(ip), ip).toBe(true)
    for (const ip of ['8.8.8.8', '93.184.216.34', '172.32.0.1', '100.128.0.1', '192.169.0.1', '1.1.1.1']) expect(blockedIp(ip), ip).toBe(false)
  })

  it('are refused as IPv6', () => {
    for (const ip of ['::', '::1', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'fe80::1%eth0', 'febf::1', 'fec0::1', 'ff02::1']) expect(blockedIp(ip), ip).toBe(true)
    for (const ip of ['2606:4700:4700::1111', '2001:4860:4860::8888', '2a00:1450:4001:81b::200e']) expect(blockedIp(ip), ip).toBe(false)
  })

  it('are refused when an IPv6 address carries them, in any spelling', () => {
    const inside = [
      '::ffff:127.0.0.1',
      // What a URL makes of [::ffff:127.0.0.1] — the spelling that used to get through.
      '::ffff:7f00:1',
      '0:0:0:0:0:ffff:7f00:1',
      '::ffff:a00:1',
      '::ffff:c0a8:101',
      '::ffff:a9fe:a9fe',
      '::ffff:0:7f00:1',
      '::127.0.0.1',
      '::7f00:1',
      '64:ff9b::7f00:1',
      '64:ff9b::10.0.0.1',
      '64:ff9b:1::1',
      '2002:7f00:1::1',
      '2002:c0a8:101::1',
    ]
    for (const ip of inside) expect(blockedIp(ip), ip).toBe(true)
    for (const ip of ['::ffff:8.8.8.8', '::ffff:808:808', '64:ff9b::808:808', '2002:808:808::1']) expect(blockedIp(ip), ip).toBe(false)
  })

  it('are refused as hosts of a URL, however the URL writes them', () => {
    const local = [
      'http://127.0.0.1/',
      'http://127.1/',
      'http://2130706433/',
      'http://0x7f.0.0.1/',
      'http://017700000001/',
      'http://[::1]/',
      'http://[::ffff:127.0.0.1]/',
      'http://[::ffff:7f00:1]:8080/',
      'http://[0:0:0:0:0:ffff:192.168.1.1]/',
      'http://[64:ff9b::127.0.0.1]/',
      'http://localhost/',
      'http://localhost./',
      'http://LOCALHOST.:3000/',
      'http://printer.local./',
      'http://nas.lan./',
      'http://app.localhost/',
      'http://metadata.google.internal/',
      'http://router/',
      'http://192.168.1.1./',
    ]
    for (const url of local) expect(blockedHost(host(url)), url).toBe(true)
    for (const url of ['https://example.com/', 'https://example.com./', 'https://8.8.8.8/', 'https://[2606:4700:4700::1111]/', 'https://local.example.com/']) expect(blockedHost(host(url)), url).toBe(false)
  })
})

describe('search results', () => {
  /** A result as the search page writes one: the link wrapped in the engine's redirect. */
  const result = (to: string, title: string) =>
    `<div class="result results_links web-result"><h2 class="result__title"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=${to}&amp;rut=abc">${title}</a></h2><a class="result__snippet" href="//duckduckgo.com/l/?uddg=${to}">About <b>${title}</b>.</a></div>`

  it('are read: where each leads, what it is called, what it says', () => {
    const html = `<html><body>${result('https%3A%2F%2Fone.example%2Fguide%3Fq%3D1', 'One')}${result('https%3A%2F%2Ftwo.example%2F', 'Two')}</body></html>`
    expect(parseSearch(html, 8)).toEqual([
      { title: 'One', url: 'https://one.example/guide?q=1', snippet: 'About One.' },
      { title: 'Two', url: 'https://two.example/', snippet: 'About Two.' },
    ])
    expect(parseSearch(html, 1)).toHaveLength(1)
  })

  it('leave out a result whose link can’t be read, and keep the rest', () => {
    // "%ZZ" is not an escape. Read as one it threw, and the whole search failed for one result.
    const html = result('https%3A%2F%2Fone.example%2Fa', 'One') + result('https%3A%2F%2Fbad.example%2F100%ZZ', 'Bad') + result('https%3A%2F%2Ftwo.example%2Fb', 'Two')
    expect(parseSearch(html, 8).map((r) => r.url)).toEqual(['https://one.example/a', 'https://two.example/b'])
  })
})

describe('what a page says of itself', () => {
  it('is read to the quote that closes it, whichever kind of quote is inside', () => {
    // It was read up to the first quote of either kind: a title with an apostrophe in it stopped there.
    expect(meta('<head><meta property="og:title" content="It\'s a Wonderful Life"></head>', 'og:title')).toBe("It's a Wonderful Life")
    expect(meta('<meta content="Don\'t stop — here\'s why" name="description">', 'description')).toBe("Don't stop — here's why")
    expect(meta(`<meta name='description' content='She said "cut" twice'>`, 'description')).toBe('She said "cut" twice')
  })

  it('is read as before where there is no such quote', () => {
    expect(meta('<meta name="description" content="Plain &amp; simple, isn&#39;t it">', 'description')).toBe("Plain & simple, isn't it")
    expect(meta("<meta property='og:site_name' content='Example'>", 'og:site_name')).toBe('Example')
    expect(meta('<meta name="description" content="">', 'description')).toBeUndefined()
    expect(meta('<meta name="keywords" content="a, b">', 'description')).toBeUndefined()
  })
})

describe('a page read for the Copilot', () => {
  const html = (body: string) => new Response(`<html><head><title>Field notes</title></head><body>${body}</body></html>`, { headers: { 'content-type': 'text/html; charset=utf-8' } })

  it('gives its links and pictures, however the page writes them', async () => {
    // Only what stood between double quotes was found. A page that writes href='…' — or, as many that are made
    // small for sending do, href=… with no quotes at all — was read as having no links and no pictures.
    env.page = () =>
      html(`<p>Notes from the field, with what to read next.</p>
        <a class="next" href="https://example.com/double">Double quotes</a>
        <a href='https://example.com/single'>Single quotes</a>
        <a href=/guides/bare class=more>No quotes</a>
        <a href="#top">Back to the top</a> <a href='#notes'>Notes</a>
        <img src="/img/one.png"> <img alt='two' src='/img/two.png'> <img src=/img/three.png width=40>`)
    const page = await readPage('https://example.com/notes')
    expect(page.title).toBe('Field notes')
    expect(page.links).toEqual([
      { text: 'Double quotes', url: 'https://example.com/double' },
      { text: 'Single quotes', url: 'https://example.com/single' },
      { text: 'No quotes', url: 'https://example.com/guides/bare' },
    ])
    expect(page.images).toEqual(['https://example.com/img/one.png', 'https://example.com/img/two.png', 'https://example.com/img/three.png'])
    expect(page.text).toContain('Notes from the field')
  })
})

describe('checkUrl', () => {
  it('lets a public address through', async () => {
    expect((await checkUrl(' https://example.com/a?b=1 ')).href).toBe('https://example.com/a?b=1')
  })

  it('refuses anything but http and https', async () => {
    for (const url of ['file:///C:/Windows/win.ini', 'ftp://example.com/', 'javascript:alert(1)', 'data:text/html,hi']) await expect(checkUrl(url)).rejects.toThrow(/Only http and https/)
    await expect(checkUrl('not a url')).rejects.toThrow(/isn’t a web address/)
  })

  it('refuses this computer and the local network', async () => {
    for (const url of ['http://[::ffff:127.0.0.1]/', 'http://localhost./', 'http://127.0.0.1:7890/', 'http://[fe80::1]/', 'http://169.254.169.254/latest/meta-data/'])
      await expect(checkUrl(url), url).rejects.toThrow(/off limits/)
  })

  it('refuses a public name that points into the local network', async () => {
    for (const address of ['127.0.0.1', '10.0.0.7', '::1', '::ffff:7f00:1', 'fd00::1']) {
      env.resolves = [
        { address: '93.184.216.34', family: 4 },
        { address, family: address.includes(':') ? 6 : 4 },
      ]
      await expect(checkUrl('https://rebind.example.com/'), address).rejects.toThrow(/points into the local network/)
    }
  })
})

describe('what a page being looked at may ask for', () => {
  browsing()
  /** Whether the session lets the request through. */
  const asks = (url: string) => new Promise<boolean>((resolve) => env.filter!({ url }, (answer) => resolve(!answer.cancel)))

  it('reaches public hosts, and its own data', async () => {
    for (const url of ['https://example.com/', 'http://cdn.example.com/a.png', 'wss://live.example.com/socket', 'data:image/png;base64,AAAA', 'blob:https://example.com/3f6d']) expect(await asks(url), url).toBe(true)
  })

  it('reaches nothing on this computer or the local network by address or by local name', async () => {
    for (const url of ['http://127.0.0.1:7890/', 'http://[::1]/', 'http://[::ffff:127.0.0.1]/', 'http://localhost./', 'http://192.168.1.1/', 'http://nas.local/', 'http://router/']) expect(await asks(url), url).toBe(false)
    // None of those needed looking up.
    expect(env.lookups).toEqual([])
  })

  it('reaches nothing through a public name that points inside', async () => {
    // Names anyone can register, pointing at this computer, a router, a cloud's metadata service.
    env.names = { 'local.attacker.example': '127.0.0.1', 'router.attacker.example': '192.168.1.1', 'meta.attacker.example': '169.254.169.254', 'six.attacker.example': '::ffff:7f00:1', 'cdn.example.org': '93.184.216.34' }
    // What such a host is called gives nothing away — which is all the session used to go by.
    expect(blockedHost('local.attacker.example')).toBe(false)
    // The page itself is public; what it puts in a frame, loads as a picture or is redirected to is not.
    expect(await asks('https://cdn.example.org/page.html')).toBe(true)
    for (const url of ['http://local.attacker.example:8080/admin', 'http://router.attacker.example/', 'http://meta.attacker.example/latest/meta-data/', 'https://six.attacker.example/', 'wss://local.attacker.example/socket'])
      expect(await asks(url), url).toBe(false)
  })

  it('looks a name up once for everything a page asks of it', async () => {
    env.names = { 'assets.example.net': '93.184.216.34' }
    for (let n = 0; n < 40; n++) expect(await asks(`https://assets.example.net/img/${n}.png`)).toBe(true)
    expect(env.lookups).toEqual(['assets.example.net'])
  })

  it('lets through a name that can’t be looked up here, and nothing that isn’t the web', async () => {
    env.names = { 'only-via-proxy.example': 'nowhere' }
    expect(await asks('https://only-via-proxy.example/')).toBe(true)
    for (const url of ['file:///C:/Windows/win.ini', 'ftp://example.com/', 'chrome://settings', 'ws://example.com/', 'not a url']) expect(await asks(url), url).toBe(false)
  })

  it('judges a host the same way wherever it is asked', async () => {
    env.names = { 'inside.example': '10.0.0.5' }
    expect(await leadsInside('inside.example')).toBe(true)
    expect(await leadsInside('INSIDE.example.')).toBe(true)
    expect(await leadsInside('[::1]')).toBe(true)
    expect(await leadsInside('8.8.8.8')).toBe(false)
  })
})
