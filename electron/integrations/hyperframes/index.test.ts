import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

// No Electron here: the session is a stand-in that keeps the request filter it is given.
const env = vi.hoisted(() => ({ temp: '', filter: null as null | ((details: { url: string }, cb: (answer: { cancel?: boolean }) => void) => void) }))
vi.mock('electron', () => ({
  app: { getPath: (name: string) => (name === 'temp' ? env.temp : `${env.temp}/${name}`), once: () => {} },
  session: {
    fromPartition: () => ({
      webRequest: { onBeforeRequest: (fn: typeof env.filter) => void (env.filter = fn) },
      setPermissionRequestHandler: () => {},
    }),
  },
  BrowserWindow: class {},
  screen: {},
}))

env.temp = path.join(os.tmpdir(), 'lumen-motion-test')
const { mayLoad, prepareHtml, readableFolders, renderSession } = await import('./index')
const { buildTemplate, TEMPLATE_NAMES } = await import('./templates')

const work = path.join(env.temp, 'lumen', 'hyperframes', 'job-1')
const folders = readableFolders()
const file = (...parts: string[]) => pathToFileURL(path.join(...parts)).href
/** A file elsewhere on this computer: the kind of thing a composition has no business reading. */
const elsewhere = file(os.homedir(), 'Documents', 'passwords.txt')

describe('what a composition may load', () => {
  it('reads its own folder and the bundled libraries', () => {
    expect(mayLoad(file(work, 'composition.html'), folders)).toBe(true)
    expect(mayLoad(file(work, 'caption-overrides.json'), folders)).toBe(true)
    for (const folder of folders.slice(1)) expect(mayLoad(file(folder, 'anything.min.js'), folders)).toBe(true)
    expect(mayLoad('data:image/png;base64,AAAA', folders)).toBe(true)
    expect(mayLoad('blob:null/3f6d7a2e-0000-4000-8000-000000000000', folders)).toBe(true)
  })

  it('reads no other file of this computer', () => {
    const outside = [
      elsewhere,
      file(os.homedir(), '.ssh', 'id_rsa'),
      file(env.temp, 'another-app', 'secret.json'),
      // A folder that only starts with the same name isn't inside it.
      file(`${path.join(env.temp, 'lumen', 'hyperframes')}-old`, 'x.png'),
      // Climbing out of the composition's folder.
      `${file(work)}/../../../../escape.txt`,
      `${file(work)}/..%2F..%2F..%2Fescape.txt`,
      // A share on the network (which would also hand the Windows sign-in to that server).
      'file://fileserver/share/picture.png',
      'file:////fileserver/share/picture.png',
      process.platform === 'win32' ? 'file:///C:/Windows/win.ini' : 'file:///etc/passwd',
    ]
    for (const url of outside) expect(mayLoad(url, folders), url).toBe(false)
  })

  it('reaches the network only for fonts and animation libraries', () => {
    for (const url of ['https://fonts.googleapis.com/css2?family=Inter', 'https://fonts.gstatic.com/s/inter/v1/a.woff2', 'https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js', 'https://unpkg.com/x', 'https://cdnjs.cloudflare.com/x'])
      expect(mayLoad(url, folders), url).toBe(true)
    for (const url of ['https://example.com/beacon?d=1', 'http://fonts.googleapis.com/css', 'http://127.0.0.1:7890/', 'https://evil-fonts.googleapis.com.example.org/', 'ws://example.com/', 'ftp://example.com/x', 'chrome://settings', 'not a url', ''])
      expect(mayLoad(url, folders), url).toBe(false)
  })

  it('is what the render window is given', () => {
    renderSession()
    const asked = (url: string) => {
      let cancelled: boolean | undefined
      env.filter!({ url }, (answer) => (cancelled = answer.cancel))
      return cancelled
    }
    expect(asked(file(work, 'composition.html'))).toBe(false)
    expect(asked(elsewhere)).toBe(true)
    expect(asked('https://example.com/')).toBe(true)
    // An address that can't even be read used to throw inside the filter.
    expect(asked('::::')).toBe(true)
  })
})

describe('the pages Lumen writes', () => {
  /** Every address a page asks for by itself: scripts, styles, pictures, fonts. */
  const asks = (html: string) => [...html.matchAll(/(?:src|href)=["']([^"']+)["']|url\(['"]?([^'")]+)['"]?\)/g)].map((m) => m[1] ?? m[2])

  it('ask only for what a composition may load', () => {
    const frame = { width: 1920, height: 1080, duration: 4 }
    const templates = (Object.keys(TEMPLATE_NAMES) as (keyof typeof TEMPLATE_NAMES)[]).filter((t) => t !== 'custom') as Exclude<keyof typeof TEMPLATE_NAMES, 'custom'>[]
    expect(templates.length).toBeGreaterThan(3)
    const custom = '<html><head><script src="https://cdn.jsdelivr.net/npm/gsap@3.13.0/dist/gsap.min.js"></script><script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/SplitText.min.js"></script></head><body></body></html>'
    const pages = [...templates.map((t) => prepareHtml(buildTemplate(t, {}, frame))), prepareHtml(custom)]
    let files = 0
    for (const page of pages) {
      const wanted = asks(page).filter((a) => /^[a-z][a-z0-9+.-]*:/i.test(a))
      expect(wanted.length).toBeGreaterThan(0)
      for (const address of wanted) {
        expect(mayLoad(address, folders), address.slice(0, 120)).toBe(true)
        if (address.startsWith('file:')) files++
      }
    }
    // GSAP and the runtime come from the bundled copies, by file: address.
    expect(files).toBeGreaterThanOrEqual(pages.length * 2)
  })
})
