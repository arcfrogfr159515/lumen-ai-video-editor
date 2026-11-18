import { beforeEach, describe, expect, it, vi } from 'vitest'

// No model, no canvas and no disk here. The model answers when the test says so — in the app it takes minutes —
// and what is written to the media folder is counted.
const env = vi.hoisted(() => ({ answer: () => {}, saved: [] as string[] }))

class FakeWorker {
  onmessage: ((e: { data: unknown }) => void) | null = null
  onerror: ((e: { message: string }) => void) | null = null
  postMessage(req: { id: number; width: number; height: number }) {
    env.answer = () => this.onmessage?.({ data: { type: 'result', id: req.id, alpha: new Uint8Array(req.width * req.height).fill(255) } })
  }
  terminate() {}
}
class FakeImage {
  crossOrigin = ''
  naturalWidth = 64
  naturalHeight = 36
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  set src(_url: string) {
    queueMicrotask(() => this.onload?.())
  }
}
const pixels = (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) })
const canvas = () => ({
  width: 0,
  height: 0,
  getContext: () => ({ drawImage: () => {}, getImageData: (_x: number, _y: number, w: number, h: number) => pixels(w, h), createImageData: pixels, putImageData: () => {} }),
  toBlob: (done: (b: Blob) => void) => done(new Blob([new Uint8Array(8)])),
})

vi.stubGlobal('Worker', FakeWorker)
vi.stubGlobal('Image', FakeImage)
vi.stubGlobal('document', { createElement: canvas })
vi.stubGlobal('location', { href: 'http://localhost/' })
vi.mock('@/engine/compositor', () => ({ clipSourceTime: (_c: unknown, local: number, fps: number) => local / fps }))
vi.mock('@/lib/platform', async (original) => ({
  ...(await original<typeof import('@/lib/platform')>()),
  desktop: {
    files: {
      saveMedia: async (folder: string, name: string) => {
        const path = `${folder}/${env.saved.length + 1}-${name}`
        env.saved.push(path)
        return { path, url: `lumen-media://${path}`, name, size: 8, mime: 'image/png', mtime: 1 }
      },
    },
  },
}))

const { addAsset, freshProject, run } = await import('@/editor/test-helpers')
const { getProject } = await import('@/editor/store')
const { subjectMatte } = await import('./segment')

const settle = () => new Promise((r) => setTimeout(r, 0))
const mattes = () => Object.values(getProject().assets).filter((a) => a.matteOf)

let clipId = ''
beforeEach(() => {
  freshProject('Trip')
  addAsset('portrait', 0, 'image')
  clipId = run('clip.add', { trackId: getProject().tracks.find((t) => t.name === 'Overlay')!.id, kind: 'image', start: 0, duration: 90, assetId: 'portrait' }) as string
  env.saved.length = 0
})

describe('a subject’s matte', () => {
  it('is added to the project its footage is in', async () => {
    const asked = subjectMatte(getProject().clips[clipId], 'person')
    await settle()
    env.answer()
    const matte = await asked
    expect(mattes().map((a) => a.id)).toEqual([matte.assetId])
    expect(getProject().assets[matte.assetId].matteOf).toMatchObject({ assetId: 'portrait', subject: 'person' })
  })

  it('is not added to another project that was opened while it was being made', async () => {
    const asked = subjectMatte(getProject().clips[clipId], 'person')
    await settle()
    // While the model works, another project is opened: one that has nothing to do with this footage.
    freshProject('Another film')
    addAsset('interview', 30)
    const before = getProject().assets
    env.answer()
    // It was added to whatever project was open by then: “portrait — person matte” stood in the other film’s
    // media, of footage that isn’t in it — put there outside the history, so not to be undone.
    await expect(asked).rejects.toThrow('The clip was removed while it was being analysed.')
    expect(mattes()).toEqual([])
    expect(getProject().assets).toEqual(before)
    // And no file is written for it.
    expect(env.saved).toEqual([])
  })

  it('is not added when its footage was removed while it was being made', async () => {
    const asked = subjectMatte(getProject().clips[clipId], 'person')
    await settle()
    run('asset.remove', { ids: ['portrait'] })
    env.answer()
    await expect(asked).rejects.toThrow('The clip was removed while it was being analysed.')
    expect(mattes()).toEqual([])
  })
})
