import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MediaFileInfo } from '@shared/app'

// No files here: a file is "read" a moment after it is asked for, as a real one is, and what the import says is kept.
const said = vi.hoisted(() => ({ success: [] as string[], error: [] as string[], dismissed: 0 }))

vi.mock('sonner', () => ({
  toast: Object.assign(() => 'note', {
    loading: () => 'importing',
    success: (text: string) => void said.success.push(text),
    error: (text: string) => void said.error.push(text),
    dismiss: () => void said.dismissed++,
  }),
}))
vi.mock('@/engine/decode', () => ({
  MediaError: class extends Error {},
  kindFromMime: (mime: string) => (mime.startsWith('video/') ? 'video' : null),
  probeMedia: () => new Promise((resolve) => setTimeout(() => resolve({ kind: 'video', duration: 12, width: 1920, height: 1080, fps: 30, hasAudio: true }), 0)),
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

const { getProject } = await import('@/editor/store')
const { freshProject } = await import('@/editor/test-helpers')
const { importMediaFiles } = await import('./media-import')

const file = (path: string): MediaFileInfo => ({ path, url: `lumen-media://${path}`, name: path.split('/').pop()!, size: 1000, mime: 'video/mp4', mtime: 1 })
const library = () => Object.values(getProject().assets).flatMap((a) => (a.source.type === 'file' && a.source.path ? [a.source.path] : []))

beforeEach(() => {
  freshProject('Imports')
  said.success.length = 0
  said.error.length = 0
  said.dismissed = 0
})

describe('importing files', () => {
  it('brings in once a file that is named twice', async () => {
    // A folder and a file in it, both given: the list of what is in them names the file twice, and it stood in the
    // media library twice.
    const assets = await importMediaFiles([file('D:/shoot/a.mp4'), file('D:/shoot/b.mp4'), file('D:/shoot/a.mp4')])
    expect(library().sort()).toEqual(['D:/shoot/a.mp4', 'D:/shoot/b.mp4'])
    expect(assets.map((a) => a.name).sort()).toEqual(['a', 'b'])
    expect(said.success).toEqual(['Imported 2 files'])
  })

  it('brings in once a file that is dropped again while it is still being read', async () => {
    // A long file takes a moment to read, and nothing shows in the library until it has been: dropped a second time
    // in that moment, it wasn't in the project yet for either import, and both added it.
    const [first, second] = await Promise.all([importMediaFiles([file('D:/shoot/long.mp4')]), importMediaFiles([file('D:/shoot/long.mp4')])])
    expect(library()).toEqual(['D:/shoot/long.mp4'])
    expect(first).toHaveLength(1)
    expect(second.map((a) => a.id)).toEqual(first.map((a) => a.id))
    // The import that found it there by then doesn't say it imported anything, and doesn't leave "Importing…" up.
    expect(said.success).toEqual(['Imported 1 file'])
    expect(said.dismissed).toBe(1)
  })

  it('brings in what is new of two overlapping imports, each file once', async () => {
    const [first, second] = await Promise.all([
      importMediaFiles([file('D:/shoot/a.mp4'), file('D:/shoot/b.mp4')]),
      importMediaFiles([file('D:/shoot/b.mp4'), file('D:/shoot/c.mp4')]),
    ])
    expect(library().sort()).toEqual(['D:/shoot/a.mp4', 'D:/shoot/b.mp4', 'D:/shoot/c.mp4'])
    expect(first.map((a) => a.name).sort()).toEqual(['a', 'b'])
    expect(second.map((a) => a.name).sort()).toEqual(['b', 'c'])
    expect(said.success.sort()).toEqual(['Imported 1 file', 'Imported 2 files'])
  })

  it('skips a file that is in the project already, and gives the one that is', async () => {
    const [first] = await importMediaFiles([file('D:/shoot/a.mp4')])
    const again = await importMediaFiles([file('d:/SHOOT/A.mp4'), file('D:/shoot/c.mp4')])
    expect(library().sort()).toEqual(['D:/shoot/a.mp4', 'D:/shoot/c.mp4'])
    expect(again.map((a) => a.id)).toContain(first.id)
    expect(again).toHaveLength(2)
  })

  it('says which file it couldn’t read, and brings in the rest', async () => {
    const failures: { name: string; reason: string }[] = []
    const assets = await importMediaFiles([{ ...file('D:/shoot/notes.txt'), mime: 'text/plain' }, file('D:/shoot/a.mp4')], failures)
    expect(assets.map((a) => a.name)).toEqual(['a'])
    expect(failures.map((f) => f.name)).toEqual(['notes.txt'])
  })
})
