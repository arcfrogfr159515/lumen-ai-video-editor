import { beforeEach, describe, expect, it, vi } from 'vitest'

// The beat grid is given to the media item: nothing is decoded or listened to here.
vi.mock('@/engine/audio-engine', () => ({ loadAudio: async () => null }))
vi.mock('@/engine/decode', () => ({ decodeAudio: async () => null }))
vi.mock('@/engine/beats', () => ({ detectBeats: async () => ({ bpm: 0, times: [], downbeats: [], confidence: 0 }) }))

const { cutToBeats } = await import('./beats')
const { useEditor } = await import('@/editor/store')
const { add, addAsset, freshProject, run, spans, trackId } = await import('@/editor/test-helpers')

let ids: string[]

beforeEach(() => {
  freshProject('Montage')
  // Music at 120 beats a minute from the start of the timeline: a beat every 15 frames.
  const times = Array.from({ length: 120 }, (_, i) => i * 0.5)
  addAsset('song', 60, 'audio')
  run('asset.update', { id: 'song', patch: { beats: { bpm: 120, times, downbeats: times.filter((_, i) => i % 4 === 0), confidence: 1 } } })
  addAsset('pictures', 60)
  add('Music', 0, 1800, { assetId: 'song' })
  // Three shots of a second each, one after another over the main track.
  ids = [add('Overlay', 0, 30, { assetId: 'pictures' }), add('Overlay', 30, 30, { assetId: 'pictures' }), add('Overlay', 60, 30, { assetId: 'pictures' })]
})

const said = (res: Awaited<ReturnType<typeof cutToBeats>>) => res.placed.map((p) => [p.start_seconds, p.beats])
const steps = () => useEditor.getState().past.length

describe('clips cut to the beat', () => {
  it('are laid one after another, each on its beat and so many beats long', async () => {
    const res = await cutToBeats(ids, { every: 4 })
    expect(said(res)).toEqual([[0, 4], [2, 4], [4, 4]])
    expect(spans('Overlay')).toEqual([[0, 60], [60, 120], [120, 180]])
    // One step to undo.
    useEditor.getState().undo()
    expect(spans('Overlay')).toEqual([[0, 30], [30, 60], [60, 90]])
  })

  it('are left where they are when a clip that isn’t one of them is in the way, and that is said', async () => {
    add('Overlay', 130, 100, { assetId: 'pictures', name: 'In the way' })
    const before = steps()
    // The third shot belongs at 120–180, where another clip lies. It was put in the nearest free place instead —
    // after that clip — and then cut to end at 180, which left one frame of it, at 230; and the answer was that
    // it had been placed at 4 s, four beats long.
    await expect(cutToBeats(ids, { every: 4 })).rejects.toThrow(/“In the way” is in the way/)
    expect(spans('Overlay')).toEqual([[0, 30], [30, 60], [60, 90], [130, 230]])
    expect(steps()).toBe(before)
  })

  it('are cut to length before they are put on the beat: a shot longer than its place has room for fits once it is cut', async () => {
    run('clip.trim', { id: ids[2], edge: 'end', frame: 160 })
    add('Overlay', 185, 100, { assetId: 'pictures', name: 'After them' })
    expect(spans('Overlay')).toEqual([[0, 30], [30, 60], [60, 160], [185, 285]])
    // The third shot is a hundred frames long and is to be sixty, from 120: there is room for that before the
    // clip at 185 — but at its full length there wasn't, and it went to the far side of that clip, to be cut there.
    const res = await cutToBeats(ids, { every: 4 })
    expect(said(res)).toEqual([[0, 4], [2, 4], [4, 4]])
    expect(spans('Overlay')).toEqual([[0, 60], [60, 120], [120, 180], [185, 285]])
  })

  it('aren’t said to have been, on a track that is locked', async () => {
    run('track.update', { id: trackId('Overlay'), patch: { locked: true } })
    const before = steps()
    // Every move was refused, and three clips were said to have been placed.
    await expect(cutToBeats(ids, { every: 4 })).rejects.toThrow(/locked/)
    expect(spans('Overlay')).toEqual([[0, 30], [30, 60], [60, 90]])
    expect(steps()).toBe(before)
  })
})
