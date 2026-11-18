import { beforeEach, describe, expect, it, vi } from 'vitest'

// No disk and no synthesizer here: the media folder is a list of what was written to it, and an effect is "rendered"
// a moment after it is asked for — as the first use of one is, in the app.
const disk = vi.hoisted(() => ({ written: [] as string[], fail: 0, stored: new Map<string, string>() }))

vi.mock('sonner', () => ({ toast: Object.assign(() => {}, { error: () => {}, success: () => {} }) }))
vi.mock('@/editor/playback', () => ({ monitorLevel: () => 1, onMonitorChange: () => () => {} }))
vi.mock('@/engine/audio-engine', () => ({ computePeaks: () => [0.2, 0.6, 0.1] }))
vi.mock('@/engine/wav', () => ({ encodeWav: () => new Uint8Array(8), resample: async (b: unknown) => b }))
vi.mock('@/engine/sfx', () => ({
  SFX: ['whoosh', 'pop', 'riser', 'boom'].map((id) => ({ id, name: id, category: 'transition' })),
  renderSfx: () => new Promise((resolve) => setTimeout(() => resolve({ duration: 0.8 }), 0)),
}))
vi.mock('@/lib/platform', async (original) => ({
  ...(await original<typeof import('@/lib/platform')>()),
  desktop: {
    files: {
      urlForPath: async (path: string) => (disk.written.includes(path) ? { url: `lumen-media://${path}`, path, name: path, size: 8, mtime: 1 } : null),
      // As the main process does it: every file written gets a name of its own.
      saveMedia: async (folder: string, name: string) => {
        if (disk.fail > 0) {
          disk.fail--
          throw new Error('The disk is full')
        }
        const path = `${folder}/${disk.written.length + 1}-${name}`
        disk.written.push(path)
        return { url: `lumen-media://${path}`, path, name, size: 8, mtime: 1 }
      },
    },
  },
}))
vi.stubGlobal('localStorage', {
  getItem: (key: string) => disk.stored.get(key) ?? null,
  setItem: (key: string, value: string) => void disk.stored.set(key, value),
  removeItem: (key: string) => void disk.stored.delete(key),
})

const { getProject } = await import('@/editor/store')
const { freshProject } = await import('@/editor/test-helpers')
const { sfxAsset } = await import('./audio-library')

const inLibrary = (id: string) => Object.values(getProject().assets).filter((a) => a.tags?.includes(`sfx:${id}`))

beforeEach(() => {
  freshProject('Effects')
  disk.written.length = 0
  disk.stored.clear()
  disk.fail = 0
})

describe('a built-in sound effect, brought into the project', () => {
  it('is one media item, asked for twice at once', async () => {
    // A model that puts one whoosh on two cuts in a single step asks for it twice at the same moment. Neither asking
    // found it in the project yet, so each wrote the file and added the effect: it stood in the media library twice.
    const [a, b] = await Promise.all([sfxAsset('whoosh'), sfxAsset('whoosh')])
    expect(a).toBe(b)
    expect(inLibrary('whoosh').map((x) => x.id)).toEqual([a])
    expect(disk.written).toHaveLength(1)
  })

  it('is the same media item when it is asked for again later, and no new file', async () => {
    const first = await sfxAsset('pop')
    expect(await sfxAsset('pop')).toBe(first)
    expect(inLibrary('pop')).toHaveLength(1)
    expect(disk.written).toHaveLength(1)
  })

  it('is its own media item, beside another effect asked for at the same moment', async () => {
    const [a, b] = await Promise.all([sfxAsset('riser'), sfxAsset('boom')])
    expect(a).not.toBe(b)
    expect(inLibrary('riser').map((x) => x.id)).toEqual([a])
    expect(inLibrary('boom').map((x) => x.id)).toEqual([b])
  })

  it('can be asked for again after it couldn’t be written', async () => {
    disk.fail = 1
    const both = await Promise.allSettled([sfxAsset('whoosh'), sfxAsset('whoosh')])
    expect(both.map((r) => r.status)).toEqual(['rejected', 'rejected'])
    expect(inLibrary('whoosh')).toHaveLength(0)
    const id = await sfxAsset('whoosh')
    expect(inLibrary('whoosh').map((x) => x.id)).toEqual([id])
  })

  it('is refused by name when there is no such effect', async () => {
    await expect(sfxAsset('kazoo')).rejects.toThrow('Unknown sound effect')
  })
})
