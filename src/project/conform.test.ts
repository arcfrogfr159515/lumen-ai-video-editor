import { beforeEach, describe, expect, it, vi } from 'vitest'

// No encoder here: a conversion is a stand-in that says what was asked of it. While `hold` is set, reading a file's
// header — the moment between a copy being asked for and its conversion existing — takes until the test says so.
const lab = vi.hoisted(() => ({
  hold: false,
  header: null as null | (() => void),
  ready: null as null | (() => void),
  inits: 0,
  executed: 0,
  begun: [] as string[],
  finished: [] as string[],
  aborted: [] as string[],
}))

vi.mock('mediabunny', () => {
  const even = { underlyingFrameRate: 30, minFrameRate: 30, maxFrameRate: 30, averageFrameRate: 30, medianFrameRate: 30, bestGuessFrameRate: 30, frameRateIsConstant: true, probedPacketCount: 300 }
  class Input {
    constructor(..._args: unknown[]) {}
    async getPrimaryVideoTrack() {
      if (lab.hold)
        await new Promise<void>((resolve) => {
          lab.header = resolve
          lab.ready?.()
        })
      return { displayWidth: 1920, displayHeight: 1080, computeFrameRateMetrics: async () => even }
    }
    getPrimaryAudioTrack = async () => null
    computeDuration = async () => 10
    dispose() {}
  }
  class Plain {
    constructor(..._args: unknown[]) {}
  }
  class Mp4OutputFormat extends Plain {
    getSupportedVideoCodecs = () => ['avc']
  }
  const Conversion = {
    init: async () => {
      lab.inits++
      let stop: (() => void) | null = null
      return {
        isValid: true,
        utilizedTracks: [],
        onProgress: null,
        execute: () =>
          new Promise<void>((resolve, reject) => {
            lab.executed++
            stop = () => reject(Object.assign(new Error('Conversion canceled'), { name: 'ConversionCanceledError' }))
            setTimeout(resolve, 5)
          }),
        cancel: async () => stop?.(),
      }
    },
  }
  return { ALL_FORMATS: [], QUALITY_VERY_HIGH: 1, Input, Conversion, Mp4OutputFormat, UrlSource: Plain, Output: Plain, StreamTarget: Plain, BufferTarget: Plain, getFirstEncodableVideoCodec: async () => 'avc' }
})
vi.mock('sonner', () => ({ toast: Object.assign(() => {}, { error: () => {}, success: () => {}, loading: () => 1, dismiss: () => {}, warning: () => {} }) }))
vi.mock('@/lib/platform', () => ({
  platform: { isMac: false },
  desktop: {
    files: {
      beginConform: async (key: string) => (lab.begun.push(key), { id: key, path: `${key}.mp4` }),
      urlForPath: async (path: string) => ({ url: `lumen-media://file/${path}`, path, name: path, size: 1000, mtime: 5 }),
    },
    export: { write: async () => {}, finish: async (id: string) => (lab.finished.push(id), { path: `${id}.mp4` }), abort: async (id: string) => void lab.aborted.push(id) },
  },
}))

const { addAsset, freshProject } = await import('@/editor/test-helpers')
const { getProject, useEditor } = await import('@/editor/store')
const { cancelConform, conformAsset, useConformJobs } = await import('./conform')

/** Resolves when the copy being made is reading its file's header. */
const reading = () => new Promise<void>((resolve) => (lab.header ? resolve() : (lab.ready = resolve)))
function headerRead() {
  const go = lab.header!
  Object.assign(lab, { hold: false, header: null, ready: null })
  go()
}

const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms))

const uneven = { variable: true, min: 12, max: 60, average: 29, median: 30, frames: 300, whole: true }
let n = 0
let id = ''
beforeEach(async () => {
  // Whatever the test before left reading a header is let finish first.
  while (lab.header) {
    headerRead()
    await settle()
  }
  Object.assign(lab, { hold: false, header: null, ready: null, inits: 0, executed: 0, begun: [], finished: [], aborted: [] })
  freshProject('Rates')
  id = addAsset(`phone-${++n}`, 10, 'video', { frameTiming: uneven })
})

describe('a constant-frame-rate copy', () => {
  it('is made, and the media plays it from then on, in one step that undo takes back', async () => {
    const original = getProject().assets[id].source
    expect(await conformAsset(id)).toBe(true)
    const asset = getProject().assets[id]
    expect(asset.conformedFrom).toMatchObject({ fileName: `${id}.mp4`, frameTiming: uneven })
    expect(asset.source).toMatchObject({ type: 'file', path: `${id}-0-30fps.mp4` })
    expect(asset.frameTiming).toMatchObject({ median: 30, whole: true })
    expect(lab).toMatchObject({ inits: 1, executed: 1, finished: [`${id}-0-30fps`], aborted: [] })
    expect(useConformJobs.getState().jobs).toEqual({})
    useEditor.getState().undo()
    expect(getProject().assets[id].source).toEqual(original)
  })

  it('is not made when Stop is pressed while it is being started', async () => {
    // The row shows Stop from the moment the copy is asked for. Until its conversion existed — the file's header is
    // read first, an encoder looked for — there was nothing for Stop to stop: it did nothing, and the copy was made.
    lab.hold = true
    const made = conformAsset(id)
    await reading()
    expect(useConformJobs.getState().jobs).toHaveProperty(id)
    cancelConform(id)
    headerRead()
    await expect(made).rejects.toMatchObject({ name: 'ConversionCanceledError' })
    expect(lab).toMatchObject({ inits: 0, executed: 0, begun: [], finished: [] })
    expect(getProject().assets[id].conformedFrom).toBeUndefined()
    expect(useConformJobs.getState().jobs).toEqual({})
  })

  it('is made once when it is asked for again while it is being started', async () => {
    // In the same moment a second asking wasn't told the first was under way: both wrote the same file.
    lab.hold = true
    const first = conformAsset(id)
    await reading()
    // Told at once that it is under way — not left to start a copy of its own.
    expect(await Promise.race([conformAsset(id), settle().then(() => 'started a second copy')])).toBe(false)
    headerRead()
    expect(await first).toBe(true)
    expect(lab).toMatchObject({ inits: 1, executed: 1, begun: [`${id}-0-30fps`], finished: [`${id}-0-30fps`] })
  })
})
