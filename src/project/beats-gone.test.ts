import { beforeEach, describe, expect, it, vi } from 'vitest'

// No audio here: the beat is found when the test says so — listening to a song the first time takes seconds — and
// is 120 beats a minute, a bar every two seconds.
const song = vi.hoisted(() => ({ heard: () => {} }))
const said = vi.hoisted(() => ({ success: [] as string[], error: [] as string[] }))
vi.mock('sonner', () => ({
  toast: Object.assign(() => {}, {
    success: (text: string) => void said.success.push(text),
    error: (text: string, more?: { description?: string }) => void said.error.push(`${text}: ${more?.description}`),
    loading: () => 'working',
    message: () => {},
    dismiss: () => {},
  }),
}))
vi.mock('@/engine/audio-engine', async (original) => ({
  ...(await original<typeof import('@/engine/audio-engine')>()),
  loadAudio: async () => ({ numberOfChannels: 1, sampleRate: 48000, getChannelData: () => new Float32Array(1) }),
}))
vi.mock('@/engine/beats', () => ({
  detectBeats: () =>
    new Promise((resolve) => {
      const times = Array.from({ length: 120 }, (_, i) => i * 0.5)
      song.heard = () => resolve({ bpm: 120, times, downbeats: times.filter((_, i) => i % 4 === 0), confidence: 1 })
    }),
}))

const { actions } = await import('@/features/shell/actions')
const { add, addAsset, freshProject, run } = await import('@/editor/test-helpers')
const { getProject } = await import('@/editor/store')
const { openSequenceId } = await import('@/editor/sequences')

const settle = () => new Promise((r) => setTimeout(r, 0))
const markers = () => (getProject().markers ?? []).map((m) => m.frame).sort((a, b) => a - b)

let n = 0
let music = ''
beforeEach(() => {
  freshProject('Montage')
  // A song nobody has listened to yet, ten seconds of it on the timeline.
  const id = `song_${++n}`
  addAsset(id, 60, 'audio')
  music = add('Music', 0, 300, { assetId: id })
  said.success.length = 0
  said.error.length = 0
})

describe('markers on the bars of a music clip', () => {
  it('are put where its bars are', async () => {
    const asked = actions.beatMarkers(music)
    await settle()
    song.heard()
    await asked
    expect(markers()).toEqual([0, 60, 120, 180, 240])
  })

  it('are put where its bars are by then, when the clip was moved while it was being listened to', async () => {
    const asked = actions.beatMarkers(music)
    await settle()
    run('clip.move', { moves: [{ id: music, start: 90 }] })
    song.heard()
    await asked
    expect(markers()).toEqual([90, 150, 210, 270, 330])
  })

  it('are not put anywhere when the clip was deleted while it was being listened to', async () => {
    const asked = actions.beatMarkers(music)
    await settle()
    run('clip.delete', { ids: [music] })
    song.heard()
    await asked
    // They were put where the bars of the clip had been.
    expect(markers()).toEqual([])
    expect(said.success).toEqual([])
    expect(said.error).toEqual(['Couldn’t find the beat: The clip was removed while it was being analysed.'])
  })

  it('are not put on another timeline that was opened while it was being listened to', async () => {
    const film = openSequenceId(getProject())
    const teaser = run('sequence.create', { name: 'Teaser', open: false }) as string
    const asked = actions.beatMarkers(music)
    await settle()
    run('sequence.open', { id: teaser })
    song.heard()
    await asked
    expect(markers()).toEqual([])
    run('sequence.open', { id: film })
    expect(markers()).toEqual([])
    expect(said.error).toEqual(['Couldn’t find the beat: The clip was removed while it was being analysed.'])
  })
})
