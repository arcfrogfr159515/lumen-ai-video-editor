import { beforeEach, describe, expect, it } from 'vitest'
import { describeCleanup, findGaps, findHoles, hasProblems, type CloseGapsResult } from './gaps'
import { getProject } from './store'
import { add, addAsset, clip, freshProject, onTrack, refusal, run, spans, trackId } from './test-helpers'

beforeEach(() => {
  freshProject('Gaps')
  addAsset('long', 60)
  addAsset('short', 2)
  addAsset('still', 0, 'image')
  addAsset('song', 120, 'audio')
})

const clean = (input: Parameters<typeof run<'timeline.closeGaps'>>[1] = {}) => run('timeline.closeGaps', input) as CloseGapsResult

describe('finding gaps', () => {
  it('tells holes in the film from space on one track', () => {
    add('Main', 0, 100, { assetId: 'long' })
    add('Overlay', 150, 50, { assetId: 'long' })
    add('Overlay', 260, 40, { assetId: 'long' })
    add('Music', 0, 120, { assetId: 'song' })
    const report = findGaps(getProject())
    // Nothing at all plays from 120 to 150, and from 200 to 260.
    expect(report.holes).toEqual([
      { start: 120, end: 150, frames: 30 },
      { start: 200, end: 260, frames: 60 },
    ])
    // The overlay coming in at 150 is not a gap; the space between its clips is.
    expect(report.gaps).toEqual([{ trackId: trackId('Overlay'), start: 200, end: 260, frames: 60, flash: false, leading: false }])
    expect(report.flashClips).toEqual([])
    expect(hasProblems(report)).toBe(true)
  })

  it('finds slivers and flash frames, and leaves captions alone', () => {
    add('Overlay', 2, 98, { assetId: 'long' })
    add('Overlay', 102, 50, { assetId: 'long', inPoint: 300 })
    const flash = add('Overlay', 152, 2, { assetId: 'long', inPoint: 600 })
    run('track.add', { kind: 'video', name: 'Captions', role: 'captions' })
    add('Captions', 0, 3, { kind: 'text' })
    const report = findGaps(getProject())
    expect(report.gaps.map((g) => [g.start, g.end, g.flash, g.leading])).toEqual([
      [0, 2, true, true],
      [100, 102, true, false],
    ])
    expect(report.flashClips.map((c) => c.clipId)).toEqual([flash])
  })

  it('has nothing to say about a clean timeline', () => {
    add('Main', 0, 100, { assetId: 'long' })
    add('Music', 0, 100, { assetId: 'song' })
    const report = findGaps(getProject())
    expect(hasProblems(report)).toBe(false)
    expect(findHoles(getProject())).toEqual([])
  })
})

describe('cleaning up', () => {
  it('closes holes on every track at once, so nothing goes out of sync', () => {
    add('Main', 0, 100, { assetId: 'long' })
    const title = add('Titles', 200, 60, { kind: 'text' })
    const music = add('Music', 180, 300, { assetId: 'song' })
    run('marker.add', { frame: 210 })
    const r = clean()
    expect(r).toMatchObject({ holesClosed: 1, framesRemoved: 80 })
    expect(clip(title).start).toBe(120)
    expect(clip(music).start).toBe(100)
    expect(getProject().markers[0].frame).toBe(130)
    // The title still starts 20 frames into the music, as it did.
    expect(clip(title).start - clip(music).start).toBe(20)
  })

  it('fills a sliver by letting the clip before it run on', () => {
    const a = add('Overlay', 0, 100, { assetId: 'long' })
    const b = add('Overlay', 102, 50, { assetId: 'long', inPoint: 300 })
    const r = clean()
    expect(r.flashGapsFilled).toBe(1)
    expect(spans('Overlay')).toEqual([
      [0, 102],
      [102, 152],
    ])
    expect(clip(a).inPoint).toBe(0)
    expect(clip(b).inPoint).toBe(300)
  })

  it('uses the clip after it when the one before has no more footage', () => {
    // The first clip plays its media to the last frame.
    add('Overlay', 0, 60, { assetId: 'short' })
    const b = add('Overlay', 62, 50, { assetId: 'long', inPoint: 300 })
    clean()
    expect(spans('Overlay')).toEqual([
      [0, 60],
      [60, 112],
    ])
    expect(clip(b).inPoint).toBe(298)
  })

  it('says so when neither side can cover a sliver', () => {
    add('Main', 0, 300, { assetId: 'long' })
    add('Overlay', 0, 60, { assetId: 'short' })
    add('Overlay', 62, 50, { assetId: 'long', inPoint: 0 })
    const r = clean()
    expect(r).toMatchObject({ flashGapsFilled: 0, left: 1 })
    expect(spans('Overlay')).toEqual([
      [0, 60],
      [62, 112],
    ])
    expect(describeCleanup(r, 30)).toMatch(/no footage either side/)
  })

  it('removes flash frames without moving what comes after', () => {
    add('Main', 0, 100, { assetId: 'long' })
    add('Main', 100, 2, { assetId: 'long', inPoint: 500 })
    add('Main', 102, 100, { assetId: 'long', inPoint: 700 })
    const overlay = add('Overlay', 150, 30, { assetId: 'long' })
    const r = clean()
    expect(r).toMatchObject({ flashClipsRemoved: 1, framesRemoved: 0 })
    expect(spans('Main')).toEqual([
      [0, 102],
      [102, 202],
    ])
    expect(clip(overlay).start).toBe(150)
  })

  it('does each kind of clean-up only when asked', () => {
    add('Overlay', 0, 100, { assetId: 'long' })
    add('Overlay', 102, 2, { assetId: 'long', inPoint: 300 })
    add('Overlay', 200, 50, { assetId: 'long', inPoint: 600 })
    const r = clean({ holes: false, flashGaps: false, flashClips: false })
    expect(r).toEqual({ holesClosed: 0, framesRemoved: 0, flashGapsFilled: 0, flashClipsRemoved: 0, trackGapsClosed: 0, left: 0 })
    expect(onTrack('Overlay')).toHaveLength(3)
    expect(describeCleanup(r, 30)).toBe('Nothing to clean up.')
  })

  it('counts a wider sliver as a flash when told to', () => {
    add('Overlay', 0, 100, { assetId: 'long' })
    add('Overlay', 108, 50, { assetId: 'long', inPoint: 300 })
    expect(clean({ holes: false }).flashGapsFilled).toBe(0)
    expect(clean({ holes: false, flashFrames: 8 }).flashGapsFilled).toBe(1)
  })

  it('closes every gap on a chosen track, taking linked clips along', () => {
    add('Main', 0, 600, { assetId: 'long' })
    const a = add('Overlay', 50, 50, { assetId: 'long' })
    const b = add('Overlay', 200, 50, { assetId: 'long', inPoint: 300 })
    const [sound] = run('clip.detachAudio', { ids: [b] }) as string[]
    const r = clean({ trackIds: [trackId('Overlay')] })
    expect(r.trackGapsClosed).toBe(1)
    // Where the track comes in stays; the space between its clips goes.
    expect(clip(a).start).toBe(50)
    expect(clip(b).start).toBe(100)
    expect(clip(sound).start).toBe(100)
  })

  it('leaves a gap when a linked clip could not follow', () => {
    add('Main', 0, 600, { assetId: 'long' })
    add('Overlay', 50, 50, { assetId: 'long' })
    const b = add('Overlay', 200, 50, { assetId: 'long', inPoint: 300 })
    const [sound] = run('clip.detachAudio', { ids: [b] }) as string[]
    // Something already plays where the sound would land.
    add(getProject().tracks.find((t) => t.id === clip(sound).trackId)!.name, 90, 60, { assetId: 'song' })
    const r = clean({ trackIds: [trackId('Overlay')] })
    expect(r.trackGapsClosed).toBe(0)
    expect(clip(b).start).toBe(200)
    expect(clip(sound).start).toBe(200)
  })

  it('fills the sliver that closing a hole leaves behind', () => {
    // Nothing plays from 100 to 148. The overlay's own gap is wider: 100 to 150 — two frames of it are left
    // once the hole has closed, under the title.
    add('Overlay', 0, 100, { assetId: 'long' })
    add('Overlay', 150, 60, { assetId: 'long', inPoint: 300 })
    run('clip.add', { trackId: trackId('Titles'), kind: 'text', start: 148, duration: 40 })
    const r = clean()
    expect(r).toMatchObject({ holesClosed: 1, framesRemoved: 48, flashGapsFilled: 1, left: 0 })
    expect(spans('Overlay')).toEqual([
      [0, 102],
      [102, 162],
    ])
    expect(findGaps(getProject())).toMatchObject({ holes: [], gaps: [] })
  })

  it('takes flash clips that sit side by side out together', () => {
    // Two leftovers in a row: neither is left to cover for the other, the clip before them takes the space.
    const a = add('Overlay', 0, 100, { assetId: 'long' })
    const one = add('Overlay', 100, 2, { assetId: 'long', inPoint: 200 })
    const two = add('Overlay', 102, 3, { assetId: 'long', inPoint: 400 })
    add('Overlay', 105, 60, { assetId: 'long', inPoint: 600 })
    expect(clean()).toMatchObject({ flashClipsRemoved: 2 })
    expect(clip(one)).toBeUndefined()
    expect(clip(two)).toBeUndefined()
    expect(clip(a).duration).toBe(105)
    expect(findGaps(getProject())).toMatchObject({ gaps: [], flashClips: [] })
  })

  it('leaves no hole where the main track closes up over a flash clip', () => {
    // The main track ends on a two-frame leftover that nothing can cover (the clip before it has no more footage);
    // music starts where it ended.
    add('Main', 0, 58, { assetId: 'short', inPoint: 2 })
    add('Main', 58, 2, { assetId: 'long', inPoint: 500 })
    add('Music', 60, 100, { assetId: 'song' })
    const r = clean()
    expect(r).toMatchObject({ flashClipsRemoved: 1, holesClosed: 1 })
    expect(spans('Main')).toEqual([[0, 58]])
    expect(spans('Music')).toEqual([[58, 158]])
    expect(findHoles(getProject())).toEqual([])
  })

  it('refuses tracks whose clips are meant to stay where they are', () => {
    run('track.update', { id: trackId('Music'), patch: { rippleLock: true } })
    expect(refusal('timeline.closeGaps', { trackIds: [trackId('Music')] })).toMatch(/ripple-locked/)
    run('track.update', { id: trackId('Overlay'), patch: { locked: true } })
    expect(refusal('timeline.closeGaps', { trackIds: [trackId('Overlay')] })).toMatch(/locked/)
  })

  it('is one undo step', () => {
    add('Overlay', 30, 100, { assetId: 'long' })
    add('Overlay', 132, 50, { assetId: 'long', inPoint: 300 })
    const before = JSON.stringify(getProject().clips)
    clean()
    expect(JSON.stringify(getProject().clips)).not.toBe(before)
    run('marker.add', { frame: 0 })
    expect(describeCleanup({ holesClosed: 2, framesRemoved: 45, flashGapsFilled: 1, flashClipsRemoved: 0, trackGapsClosed: 0, left: 0 }, 30)).toBe('Closed 2 holes, filled 1 sliver. The timeline is 1.5 s shorter.')
  })
})
