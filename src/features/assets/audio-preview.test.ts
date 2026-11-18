import { beforeEach, describe, expect, it, vi } from 'vitest'

// No sound here: an audio element is a stand-in that says whether it is playing.
const lab = vi.hoisted(() => ({ made: [] as { paused: boolean; dataset: Record<string, string> }[] }))

class FakeAudio {
  paused = true
  volume = 1
  crossOrigin = ''
  dataset: Record<string, string> = {}
  onplay: (() => void) | null = null
  onpause: (() => void) | null = null
  onended: (() => void) | null = null
  constructor(readonly src: string) {
    lab.made.push(this)
  }
  async play() {
    this.paused = false
    this.onplay?.()
  }
  pause() {
    if (this.paused) return
    this.paused = true
    this.onpause?.()
  }
}
vi.stubGlobal('Audio', FakeAudio)
vi.stubGlobal('requestAnimationFrame', () => 0)
vi.stubGlobal('cancelAnimationFrame', () => {})

const { addAsset, freshProject, run } = await import('@/editor/test-helpers')
const { getProject } = await import('@/editor/store')
const { onPreviewChange, previewing, togglePreview } = await import('./audio-preview')

const urlOf = (id: string) => {
  const source = getProject().assets[id].source
  return source.type === 'file' ? source.url : ''
}
/** Elements that are making sound. */
const sounding = () => lab.made.filter((a) => !a.paused).length

beforeEach(() => {
  for (const a of lab.made) a.paused = true
  lab.made.length = 0
  freshProject('Previews')
  addAsset('song', 240, 'audio')
  addAsset('voice', 30, 'audio')
})

describe('listening to a sound in the media library', () => {
  it('plays one at a time, and pauses the one playing when its button is pressed again', () => {
    let changes = 0
    const off = onPreviewChange(() => changes++)
    togglePreview(urlOf('song'))
    expect([previewing(urlOf('song')), previewing(urlOf('voice')), sounding()]).toEqual([true, false, 1])
    togglePreview(urlOf('voice'))
    expect([previewing(urlOf('song')), previewing(urlOf('voice')), sounding()]).toEqual([false, true, 1])
    togglePreview(urlOf('voice'))
    expect([previewing(urlOf('voice')), sounding()]).toEqual([false, 0])
    expect(changes).toBeGreaterThan(0)
    off()
  })

  it('stops when the sound is removed from the project: its row, and the button on it, go with it', () => {
    const song = urlOf('song')
    togglePreview(song)
    // An edit that has nothing to do with it leaves it playing.
    run('asset.update', { id: 'voice', patch: { favorite: true } })
    expect(sounding()).toBe(1)
    run('asset.remove', { ids: ['song'] })
    expect([previewing(song), sounding()]).toEqual([false, 0])
  })

  it('stops when another project is opened', () => {
    togglePreview(urlOf('song'))
    freshProject('Another film')
    expect(sounding()).toBe(0)
  })
})
