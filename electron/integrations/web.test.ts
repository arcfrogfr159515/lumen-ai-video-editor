import { beforeEach, describe, expect, it, vi } from 'vitest'

// No network here: names resolve to whatever each test says.
const env = vi.hoisted(() => ({ resolves: [{ address: '93.184.216.34', family: 4 }] as { address: string; family: number }[] }))
vi.mock('electron', () => ({ net: {}, nativeImage: {}, session: {}, BrowserWindow: class {}, screen: {} }))
vi.mock('node:dns/promises', () => ({ lookup: async () => env.resolves }))

const { blockedHost, blockedIp, checkUrl } = await import('./web')

beforeEach(() => {
  env.resolves = [{ address: '93.184.216.34', family: 4 }]
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
