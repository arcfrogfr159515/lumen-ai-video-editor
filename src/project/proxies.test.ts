import { beforeEach, describe, expect, it, vi } from 'vitest'

// No encoder here: a conversion is a stand-in that says what was asked of it, and reading the file's header — the
// moment between a proxy being taken off the queue and its conversion existing — takes until the test says so.
const lab = vi.hoisted(() => ({
  inits: [] as string[],
  executed: 0,
  cancelled: 0,
  written: [] as string[],
  aborted: [] as string[],
  header: null as null | (() => void),
  ready: null as null | (() => void),
}))

vi.mock('mediabunny', () => {
  class Input {
    constructor(readonly opts: { source: { url: string } }) {}
    async getPrimaryVideoTrack() {
      await new Promise<void>((resolve) => {
        lab.header = resolve
        lab.ready?.()
      })
      return { displayWidth: 3840, displayHeight: 2160 }
    }
    dispose() {}
  }
  class UrlSource {
    constructor(readonly url: string) {}
  }
  class Plain {
    constructor(..._args: unknown[]) {}
  }
  const Conversion = {
    init: async (opts: { input: Input }) => {
      lab.inits.push(opts.input.opts.source.url)
      let stop: (() => void) | null = null
      return {
        isValid: true,
        onProgress: null,
        execute: () =>
          new Promise<void>((resolve, reject) => {
            lab.executed++
            stop = () => reject(Object.assign(new Error('Conversion canceled'), { name: 'ConversionCanceledError' }))
            setTimeout(resolve, 5)
          }),
        cancel: async () => {
          lab.cancelled++
          stop?.()
        },
      }
    },
  }
  return { ALL_FORMATS: [], QUALITY_MEDIUM: 1, Input, UrlSource, Conversion, Mp4OutputFormat: Plain, Output: Plain, StreamTarget: Plain }
})
vi.mock('sonner', () => ({ toast: Object.assign(() => {}, { error: () => {}, success: () => {}, loading: () => 1, dismiss: () => {}, warning: () => {} }) }))
vi.mock('@/lib/platform', () => ({
  platform: { isMac: false },
  desktop: {
    files: { beginProxy: async (key: string) => ({ id: key, path: `${key}.mp4` }), urlForPath: async (path: string) => ({ url: `lumen-media://file/${path}`, path }) },
    export: {
      write: async () => {},
      finish: async (id: string) => (lab.written.push(id), { path: `${id}.mp4` }),
      abort: async (id: string) => void lab.aborted.push(id),
    },
  },
}))

const { addAsset, freshProject } = await import('@/editor/test-helpers')
const { getProject } = await import('@/editor/store')
const { cancelProxy, ensureProxies, makeProxy, useProxyJobs } = await import('./proxies')

const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms))
/** Resolves when the proxy being made is reading its file's header. */
const reading = () => new Promise<void>((resolve) => (lab.header ? resolve() : (lab.ready = resolve)))
function headerRead() {
  const go = lab.header!
  lab.header = null
  lab.ready = null
  go()
}

let n = 0
let id = ''
beforeEach(async () => {
  // Whatever the test before left being made is let finish first: proxies are made one at a time.
  while (lab.header) {
    headerRead()
    await settle()
  }
  Object.assign(lab, { inits: [], executed: 0, cancelled: 0, written: [], aborted: [], header: null, ready: null })
  freshProject('Proxies')
  id = addAsset(`heavy-${++n}`, 60, 'video', { width: 3840, height: 2160 })
})

describe('making a proxy', () => {
  it('makes one, and gives it to the media it was made for', async () => {
    makeProxy(id)
    await reading()
    expect(useProxyJobs.getState().jobs).toHaveProperty(id)
    headerRead()
    await settle()
    expect(lab).toMatchObject({ inits: [`${id}.mp4`], executed: 1, written: [`${id}-0`] })
    expect(getProject().assets[id].proxy).toMatchObject({ width: 960, height: 540 })
    expect(useProxyJobs.getState().jobs).toEqual({})
  })

  it('makes it once when it is asked for again while it is being started', async () => {
    // Off the queue, and not yet a conversion that could be cancelled: in that moment the proxy was known nowhere,
    // and asking again queued it again. The media list changing asks again by itself — a waveform arriving is
    // enough — so heavy footage was transcoded twice, the second time over the file the preview was playing.
    makeProxy(id)
    await reading()
    makeProxy(id)
    ensureProxies(getProject())
    headerRead()
    await settle()
    // The second making, had there been one, would be reading the file's header now.
    expect(lab.header).toBeNull()
    expect(lab).toMatchObject({ inits: [`${id}.mp4`], executed: 1, written: [`${id}-0`] })
  })

  it('is not made when it is cancelled while it is being started', async () => {
    // In the same moment there was nothing to cancel either: Cancel did nothing, and the proxy was made all the same.
    makeProxy(id)
    await reading()
    cancelProxy(id)
    headerRead()
    await settle()
    // Nothing was converted, and no file was begun for it.
    expect(lab).toMatchObject({ inits: [], executed: 0, written: [], aborted: [] })
    expect(getProject().assets[id].proxy).toBeUndefined()
    expect(useProxyJobs.getState().jobs).toEqual({})
    // Cancelled is not asked for again by itself.
    ensureProxies(getProject())
    await settle(5)
    expect(lab.header).toBeNull()
  })
})
