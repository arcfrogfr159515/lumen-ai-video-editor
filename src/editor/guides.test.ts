import { beforeEach, describe, expect, it } from 'vitest'
import { carriesSpeech, clipGuides, mergeSceneCuts, nearestGuide, timelineGuides, transcriptPauses, waveformPauses } from './guides'
import { getProject } from './store'
import { add, addAsset, clip, freshProject, run, trackId, transcript } from './test-helpers'

beforeEach(() => {
  freshProject('Guides')
  // Three sentences with two pauses: 2.0–3.0 s and 5.5–6.0 s. The 0.1 s breath at 4.0 is not a pause.
  addAsset('talk', 20, 'video', { transcript: transcript([0.5, 2, 'First sentence.'], [3, 4, 'Second'], [4.1, 5.5, 'sentence.'], [6, 9, 'Third sentence.']), sceneCuts: [4.5, 12] })
  addAsset('song', 60, 'audio')
})

const guides = (id: string, opts?: Parameters<typeof clipGuides>[2]) => clipGuides(getProject(), clip(id), opts).map((g) => [g.local, g.kind])

describe('pauses', () => {
  it('are the silences between phrases of a transcript', () => {
    expect(transcriptPauses(getProject().assets.talk.transcript!)).toEqual([
      [2, 3],
      [5.5, 6],
    ])
    // Out of order and overlapping phrases still read right.
    expect(transcriptPauses(transcript([3, 4, 'b'], [0, 2.5, 'a'], [1, 2, 'inside a']))).toEqual([[2.5, 3]])
  })

  it('are read off a waveform when there is no transcript', () => {
    // 50 peaks a second: 1 s of sound, 0.5 s of quiet, 1 s of sound, a 0.1 s dip, 1 s of sound, then silence to the end.
    const peaks = [...Array(50).fill(0.6), ...Array(25).fill(0.004), ...Array(50).fill(0.5), ...Array(5).fill(0.004), ...Array(50).fill(0.7), ...Array(40).fill(0)]
    expect(waveformPauses(peaks)).toEqual([[1, 1.5]])
    // A quiet recording is judged against itself.
    expect(waveformPauses(peaks.map((p) => p * 0.1))).toEqual([[1, 1.5]])
    expect(waveformPauses(Array(200).fill(0))).toEqual([])
    expect(waveformPauses([0.5, 0.5])).toEqual([])
  })
})

describe('guides in a clip', () => {
  it('sit where talking stops and starts again, and where shots change', () => {
    const id = add('Main', 100, 300, { assetId: 'talk' })
    expect(guides(id)).toEqual([
      [60, 'pause'],
      [90, 'speech'],
      [135, 'cut'],
      [165, 'pause'],
      [180, 'speech'],
    ])
    expect(guides(id, { pauses: false })).toEqual([[135, 'cut']])
    expect(guides(id, { cuts: false })).toHaveLength(4)
  })

  it('follow trims, speed and reverse', () => {
    const id = add('Main', 0, 120, { assetId: 'talk', inPoint: 75 })
    // The clip plays source 2.5–6.5 s: it starts inside the first pause.
    expect(guides(id)).toEqual([
      [15, 'speech'],
      [60, 'cut'],
      [90, 'pause'],
      [105, 'speech'],
    ])
    run('clip.update', { ids: [id], patch: { speed: 2 } })
    expect(guides(id)).toEqual([
      [8, 'speech'],
      [30, 'cut'],
      [45, 'pause'],
      [53, 'speech'],
    ])
    run('clip.update', { ids: [id], patch: { speed: 1, reverse: true } })
    // Backwards, talking stops where it used to start.
    expect(guides(id)).toEqual([
      [15, 'pause'],
      [30, 'speech'],
      [60, 'cut'],
      [105, 'pause'],
    ])
  })

  it('leave music alone, and sound that has been detached from its picture', () => {
    const music = add('Music', 0, 300, { assetId: 'song' })
    run('asset.update', { id: 'song', patch: { peaks: [...Array(100).fill(0.5), ...Array(50).fill(0), ...Array(100).fill(0.5)] } })
    expect(carriesSpeech(getProject(), clip(music))).toBe(false)
    expect(guides(music)).toEqual([])
    // The same file on a voice track is read.
    const voice = add('Voice', 0, 300, { assetId: 'song' })
    expect(guides(voice)).toEqual([
      [60, 'pause'],
      [90, 'speech'],
    ])
    const v = add('Main', 0, 300, { assetId: 'talk' })
    const [sound] = run('clip.detachAudio', { ids: [v] }) as string[]
    // The picture keeps its shot cuts; the pauses belong to the sound clip now.
    expect(guides(v)).toEqual([[135, 'cut']])
    expect(guides(sound).map((g) => g[1])).toEqual(['pause', 'speech', 'pause', 'speech'])
  })
})

describe('guides on the timeline', () => {
  it('are in timeline frames, in order, and skip locked tracks', () => {
    const a = add('Main', 0, 300, { assetId: 'talk' })
    add('Overlay', 400, 100, { assetId: 'talk', inPoint: 330 })
    const all = timelineGuides(getProject())
    expect(all.map((g) => g.frame)).toEqual([60, 90, 135, 165, 180, 430])
    expect(all[2]).toEqual({ frame: 135, kind: 'cut', clipId: a })
    expect(nearestGuide(all, 170, 6)?.frame).toBe(165)
    expect(nearestGuide(all, 120, 6)).toBeNull()
    run('track.update', { id: trackId('Overlay'), patch: { locked: true } })
    expect(timelineGuides(getProject()).map((g) => g.frame)).toEqual([60, 90, 135, 165, 180])
    expect(timelineGuides(getProject(), { pauses: false }).map((g) => g.frame)).toEqual([135])
  })
})

describe('shot cuts', () => {
  it('replace what was known in the stretch that was analysed, and keep the rest', () => {
    expect(mergeSceneCuts(undefined, [3.2, 7.75], 0, 10)).toEqual([3.2, 7.75])
    expect(mergeSceneCuts([1, 4.5, 12, 30], [5, 9.0004], 4, 15)).toEqual([1, 5, 9, 30])
    expect(mergeSceneCuts([1, 2], [], 0, 5)).toEqual([])
    expect(mergeSceneCuts([5], [5.0002], 20, 30)).toEqual([5])
  })

  it('are kept on the media, sorted, and can be forgotten', () => {
    run('asset.update', { id: 'talk', patch: { sceneCuts: [9, 3, 6] } })
    expect(getProject().assets.talk.sceneCuts).toEqual([3, 6, 9])
    run('asset.update', { id: 'talk', patch: { sceneCuts: null } })
    expect('sceneCuts' in getProject().assets.talk).toBe(false)
  })
})
