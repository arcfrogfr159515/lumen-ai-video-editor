import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MediaFileInfo } from '@shared/app'

// No files here: the file picked in the Relink dialog is the one the test names, and it is "read" as a 4K video.
const picked = vi.hoisted(() => ({ file: null as MediaFileInfo | null }))

vi.mock('sonner', () => ({ toast: Object.assign(() => {}, { error: () => {}, success: () => {}, loading: () => 1, dismiss: () => {} }) }))
vi.mock('@/engine/decode', () => ({
  MediaError: class extends Error {},
  kindFromMime: (mime: string) => (mime.startsWith('video/') ? 'video' : null),
  probeMedia: async () => ({ kind: 'video', duration: 12, width: 3840, height: 2160, fps: 30, hasAudio: true }),
}))
vi.mock('@/engine/audio-engine', () => ({
  audioLeaves: () => [],
  audioSourceUrl: () => null,
  computePeaks: () => [],
  computePeaksStreamed: async () => null,
  isLongAudio: () => false,
  loadAudio: async () => null,
  pruneAudio: () => {},
}))
vi.mock('@/lib/platform', () => ({
  platform: { isMac: false },
  desktop: { files: { relink: async () => picked.file } },
}))

const { getProject, useEditor } = await import('@/editor/store')
const { addAsset, freshProject } = await import('@/editor/test-helpers')
const { relinkAsset } = await import('./media-import')

const PROXY = { path: 'C:/lumen/proxies/drone-100.mp4', url: 'lumen-media://file/proxies/drone-100.mp4', width: 960, height: 540 }
const file = (path: string, size: number, mtime: number): MediaFileInfo => ({ path, url: `lumen-media://file/${path}`, name: path.split('/').pop()!, size, mime: 'video/mp4', mtime })
const drone = () => getProject().assets.drone

/** A heavy video the preview plays a proxy of: `D:/shoot/drone.mp4`, 5000 bytes, last changed at 100. */
beforeEach(() => {
  freshProject('Relink')
  addAsset('drone', 12, 'video', {
    width: 3840,
    height: 2160,
    source: { type: 'file', url: 'lumen-media://file/D:/shoot/drone.mp4', path: 'D:/shoot/drone.mp4', mime: 'video/mp4', fileName: 'drone.mp4', size: 5000, mtime: 100 },
    proxy: PROXY,
  })
})

describe('relinking media the preview plays a proxy of', () => {
  it('lets go of the proxy when another file is picked', async () => {
    // A new version of the shot, rendered again: other bytes, another date. The proxy was made from the old one, and
    // the preview went on playing it — the old pictures — while exports and stills read the new file.
    picked.file = file('D:/shoot/drone v2.mp4', 6200, 250)
    expect(await relinkAsset('drone')).toBe(true)
    expect(drone().source).toMatchObject({ path: 'D:/shoot/drone v2.mp4', size: 6200, mtime: 250 })
    expect(drone().proxy).toBeUndefined()
  })

  it('lets go of it when the file picked has the same name and size and another date', async () => {
    picked.file = file('D:/shoot/drone.mp4', 5000, 300)
    expect(await relinkAsset('drone')).toBe(true)
    expect(drone().proxy).toBeUndefined()
  })

  it('keeps the proxy when it is the same file, somewhere else', async () => {
    // Moved to another folder: the same bytes, the same date. Its proxy is still a copy of it.
    picked.file = file('E:/archive/drone.mp4', 5000, 100)
    expect(await relinkAsset('drone')).toBe(true)
    expect(drone().source).toMatchObject({ path: 'E:/archive/drone.mp4' })
    expect(drone().proxy).toEqual(PROXY)
  })

  it('gives the file and its proxy back together when the relink is undone', async () => {
    picked.file = file('D:/shoot/drone v2.mp4', 6200, 250)
    await relinkAsset('drone')
    useEditor.getState().undo()
    expect(drone().source).toMatchObject({ path: 'D:/shoot/drone.mp4', mtime: 100 })
    expect(drone().proxy).toEqual(PROXY)
  })
})
