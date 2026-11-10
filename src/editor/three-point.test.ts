import { beforeEach, describe, expect, it } from 'vitest'
import { getProject } from './store'
import { add, addAsset, clip, freshProject, onTrack, refusal, run, spans, trackId } from './test-helpers'
import { rng } from './test-invariants'
import { describeEdit, resolveEdit, type EditPoints } from './three-point'

const base: EditPoints = { playhead: 500, sourceLength: 900 }
const edit = (pts: Partial<EditPoints>, mode?: Parameters<typeof resolveEdit>[2]) => {
  const r = resolveEdit({ ...base, ...pts }, 30, mode)
  return [r.start, r.duration, r.inPoint, r.speed, r.backtimed, r.short]
}

describe('working out an edit from its points', () => {
  it('three points settle the fourth', () => {
    // Source in and out, timeline in.
    expect(edit({ sourceIn: 100, sourceOut: 250, timelineIn: 300 })).toEqual([300, 150, 100, 1, false, 0])
    // Source in and out, timeline out: placed from its end backwards.
    expect(edit({ sourceIn: 100, sourceOut: 250, timelineOut: 400 })).toEqual([250, 150, 100, 1, true, 0])
    // Source in, timeline in and out: the timeline says how long.
    expect(edit({ sourceIn: 100, timelineIn: 300, timelineOut: 360 })).toEqual([300, 60, 100, 1, false, 0])
    // Source out, timeline in and out: the source is counted back from its out point.
    expect(edit({ sourceOut: 250, timelineIn: 300, timelineOut: 360 })).toEqual([300, 60, 190, 1, true, 0])
  })

  it('falls back on the playhead and the ends of the source', () => {
    expect(edit({})).toEqual([500, 900, 0, 1, false, 0])
    expect(edit({ sourceIn: 600 })).toEqual([500, 300, 600, 1, false, 0])
    expect(edit({ sourceOut: 90 })).toEqual([500, 90, 0, 1, false, 0])
    expect(edit({ sourceIn: 100, sourceOut: 250 })).toEqual([500, 150, 100, 1, false, 0])
    expect(edit({ timelineIn: 40 })).toEqual([40, 900, 0, 1, false, 0])
    expect(edit({ timelineIn: 40, timelineOut: 100 })).toEqual([40, 60, 0, 1, false, 0])
    // Only an out point on the timeline: the whole source ends there.
    expect(edit({ timelineOut: 1000 })).toEqual([100, 900, 0, 1, true, 0])
  })

  it('four points that disagree are settled by the mode', () => {
    const four = { sourceIn: 100, sourceOut: 280, timelineIn: 300, timelineOut: 360 }
    // 180 frames of source into 60 of timeline: three times the speed.
    expect(edit(four, 'fit')).toEqual([300, 60, 100, 3, false, 0])
    expect(edit(four, 'source')).toEqual([300, 180, 100, 1, false, 0])
    expect(edit(four, 'timeline')).toEqual([300, 60, 100, 1, false, 0])
    // Slow motion, and the limits of what a clip can play at.
    expect(edit({ ...four, sourceOut: 130 }, 'fit')).toEqual([300, 60, 100, 0.5, false, 0])
    expect(edit({ ...four, sourceOut: 102 }, 'fit')[3]).toBe(0.1)
    // Four points that agree need no settling.
    expect(edit({ ...four, sourceOut: 160 }, 'fit')).toEqual([300, 60, 100, 1, false, 0])
    expect(resolveEdit({ ...base, ...four }, 30).points).toBe(4)
  })

  it('says when the source runs out before the timeline stretch is filled', () => {
    // 100 frames are left after the in point; the timeline wants 200.
    expect(edit({ sourceIn: 800, timelineIn: 0, timelineOut: 200 })).toEqual([0, 100, 800, 1, false, 100])
    // Backtimed from frame 50 of the source there are only 50 frames: the out points still line up.
    expect(edit({ sourceOut: 50, timelineIn: 0, timelineOut: 200 })).toEqual([150, 50, 0, 1, true, 150])
  })

  it('loses the head of an edit backtimed past the start of the timeline', () => {
    expect(edit({ sourceIn: 100, sourceOut: 250, timelineOut: 60 })).toEqual([0, 60, 190, 1, true, 0])
    expect(resolveEdit({ ...base, sourceIn: 100, sourceOut: 250, timelineOut: 60 }, 30).headLost).toBe(90)
  })

  it('reads marks the wrong way round, or outside the source, as unmarked', () => {
    expect(edit({ sourceIn: 300, sourceOut: 200 })).toEqual([500, 600, 300, 1, false, 0])
    expect(edit({ sourceIn: 5000 })).toEqual([500, 1, 899, 1, false, 0])
    expect(edit({ timelineIn: 100, timelineOut: 100 })).toEqual([100, 900, 0, 1, false, 0])
  })

  it('gives a still five seconds unless the timeline says otherwise', () => {
    const still = { playhead: 0, sourceLength: Infinity }
    expect(resolveEdit(still, 30)).toMatchObject({ start: 0, duration: 150, inPoint: 0 })
    expect(resolveEdit({ ...still, timelineIn: 10, timelineOut: 400 }, 30)).toMatchObject({ start: 10, duration: 390 })
  })

  it('describes itself', () => {
    const tc = (f: number) => `f${f}`
    expect(describeEdit(resolveEdit({ ...base, sourceIn: 100, sourceOut: 250, timelineOut: 400 }, 30), 30, tc)).toBe('Three-point: 5 s at f250 · backtimed from the out point')
    expect(describeEdit(resolveEdit({ ...base, sourceIn: 100, sourceOut: 280, timelineIn: 300, timelineOut: 360 }, 30, 'fit'), 30, tc)).toBe('Four-point: 2 s at f300 · fitted at 3×')
    expect(describeEdit(resolveEdit(base, 30), 30, tc)).toBe('At the playhead: 30 s at f500')
  })
})

describe('whatever points are marked', () => {
  for (let seed = 1; seed <= (Number(process.env.FUZZ_RUNS) || 40); seed++) {
    it(`the edit keeps to the source and to the points it was given (run ${seed})`, () => {
      const r = rng(seed * 3571)
      const length = r.chance(0.1) ? Infinity : r.int(2, 2000)
      const some = <T,>(make: () => T) => (r.chance(0.6) ? make() : undefined)
      const limit = Number.isFinite(length) ? length : 2000
      const pts: EditPoints = { playhead: r.int(0, 3000), sourceLength: length, sourceIn: some(() => r.int(0, limit + 20)), sourceOut: some(() => r.int(0, limit + 20)), timelineIn: some(() => r.int(0, 3000)), timelineOut: some(() => r.int(0, 3000)) }
      const mode = r.pick(['fit', 'source', 'timeline'] as const)
      const e = resolveEdit(pts, 30, mode)
      const told = `seed ${seed}: ${JSON.stringify(pts)} ${mode} → ${JSON.stringify(e)}`
      // It is a clip: on whole frames, on the timeline, with a length.
      for (const n of [e.start, e.duration, e.inPoint]) expect(Number.isInteger(n), told).toBe(true)
      expect(e.start, told).toBeGreaterThanOrEqual(0)
      expect(e.duration, told).toBeGreaterThanOrEqual(1)
      expect(e.inPoint, told).toBeGreaterThanOrEqual(0)
      // It never plays past the end of the source (a hair's slack for a fitted speed rounded to three places).
      if (Number.isFinite(length)) expect(e.inPoint + e.duration * e.speed, told).toBeLessThanOrEqual(length + 0.5 + e.duration * 0.0005)

      // The marks as the edit reads them: outside the source or the wrong way round is unmarked.
      const sIn = pts.sourceIn !== undefined ? Math.min(pts.sourceIn, Number.isFinite(length) ? length - 1 : Infinity) : undefined
      let sOut = pts.sourceOut !== undefined ? Math.min(Math.max(pts.sourceOut, 1), length) : undefined
      if (sIn !== undefined && sOut !== undefined && sOut <= sIn) sOut = undefined
      const tIn = pts.timelineIn
      let tOut = pts.timelineOut ? pts.timelineOut : undefined
      if (tIn !== undefined && tOut !== undefined && tOut <= tIn) tOut = undefined
      const S = sIn !== undefined && sOut !== undefined ? sOut - sIn : undefined
      const T = tIn !== undefined && tOut !== undefined ? tOut - tIn : undefined

      // A source in point is where it starts in the source — unless its head was lost to the start of the timeline.
      if (sIn !== undefined && !e.headLost) expect(e.inPoint, told).toBe(sIn)
      // It is never longer than a stretch that was marked, in the source or on the timeline.
      if (S !== undefined && e.speed === 1 && !(T !== undefined && mode === 'timeline')) expect(e.duration, told).toBeLessThanOrEqual(S)
      if (T !== undefined && !(S !== undefined && S !== T && mode === 'source')) expect(e.duration, told).toBeLessThanOrEqual(T)
      // Only fitting changes the speed, and only when both stretches are marked and differ.
      if (!(mode === 'fit' && S !== undefined && T !== undefined && S !== T)) expect(e.speed, told).toBe(1)
      // A timeline in point is where it starts, unless the edit is placed from its end.
      if (tIn !== undefined && !e.backtimed) expect(e.start, told).toBe(tIn)
      // Placed from its end, it ends on the timeline out point.
      if (e.backtimed) expect(e.start + e.duration, told).toBe(tOut)
      // With nothing marked on the timeline it goes at the playhead.
      if (tIn === undefined && tOut === undefined) expect(e.start, told).toBe(pts.playhead)
      // Three points and enough source: the fourth is exactly what the other three make it.
      if (S !== undefined && tIn !== undefined && tOut === undefined) expect([e.start, e.duration, e.inPoint], told).toEqual([tIn, S, sIn])
      if (S !== undefined && tIn === undefined && tOut !== undefined && tOut >= S) expect([e.start, e.duration, e.inPoint], told).toEqual([tOut - S, S, sIn])
      if (T !== undefined && sIn !== undefined && sOut === undefined && length - sIn >= T) expect([e.start, e.duration, e.inPoint], told).toEqual([tIn, T, sIn])
      if (T !== undefined && sIn === undefined && sOut !== undefined && sOut >= T) expect([e.start, e.duration, e.inPoint], told).toEqual([tIn, T, sOut - T])
    })
  }
})

describe('the edit on the timeline', () => {
  beforeEach(() => {
    freshProject('Three-point')
    addAsset('long', 60)
    addAsset('insert', 30)
    addAsset('song', 120, 'audio')
    add('Main', 0, 300, { assetId: 'long' })
    add('Titles', 200, 100, { kind: 'text' })
    add('Music', 0, 400, { assetId: 'song' })
    run('marker.add', { frame: 250 })
  })

  const threePoint = (input: Partial<Parameters<typeof run<'timeline.threePointEdit'>>[1]> = {}) =>
    run('timeline.threePointEdit', { assetId: 'insert', trackId: trackId('Main'), at: 150, sourceIn: 90, sourceOut: 150, ...input }) as { clipId: string; start: number; duration: number }

  it('inserts: everything after the point moves later, on every track in sync', () => {
    const r = threePoint({ mode: 'insert' })
    expect(r).toMatchObject({ start: 150, duration: 60 })
    expect(spans('Main')).toEqual([
      [0, 150],
      [150, 210],
      [210, 360],
    ])
    expect(clip(r.clipId)).toMatchObject({ assetId: 'insert', inPoint: 90 })
    // The second half of the cut clip carries on where the first left off.
    expect(onTrack('Main')[2].inPoint).toBe(150)
    // The title after the point moved with the picture; the music was cut and moved too.
    expect(spans('Titles')).toEqual([[260, 360]])
    expect(spans('Music')).toEqual([
      [0, 150],
      [210, 460],
    ])
    expect(getProject().markers[0].frame).toBe(310)
  })

  it('leaves a track alone when its sync lock is off', () => {
    run('track.update', { id: trackId('Music'), patch: { syncLock: false } })
    threePoint({ mode: 'insert' })
    expect(spans('Music')).toEqual([[0, 400]])
    expect(spans('Titles')).toEqual([[260, 360]])
  })

  it('overwrites: what was there is covered and nothing moves', () => {
    const r = threePoint({ mode: 'overwrite' })
    expect(spans('Main')).toEqual([
      [0, 150],
      [150, 210],
      [210, 300],
    ])
    expect(onTrack('Main')[2].inPoint).toBe(210)
    expect(spans('Titles')).toEqual([[200, 300]])
    expect(spans('Music')).toEqual([[0, 400]])
    expect(clip(r.clipId).start).toBe(150)
  })

  it('uses the marked stretch of the timeline, backtiming from its out point', () => {
    run('timeline.setRange', { range: { in: 60, out: 120 } })
    // Source in + timeline in and out: the timeline decides the length.
    const a = threePoint({ mode: 'overwrite', sourceOut: undefined })
    expect(a).toMatchObject({ start: 60, duration: 60 })
    expect(clip(a.clipId).inPoint).toBe(90)
    // Marks ignored on request: back to the given frame.
    const b = threePoint({ mode: 'overwrite', useRange: false })
    expect(b.start).toBe(150)
  })

  it('fits four points by changing the speed', () => {
    run('timeline.setRange', { range: { in: 60, out: 90 } })
    const r = threePoint({ mode: 'overwrite', fit: 'fit' })
    expect(clip(r.clipId)).toMatchObject({ start: 60, duration: 30, speed: 2, inPoint: 90 })
  })

  it('goes on an overlay track without touching the main track', () => {
    const r = threePoint({ mode: 'overwrite', trackId: trackId('Overlay') })
    expect(clip(r.clipId).trackId).toBe(trackId('Overlay'))
    expect(spans('Main')).toEqual([[0, 300]])
  })

  it('refuses the wrong kind of track, a locked one, and an insert into a ripple-locked one', () => {
    expect(refusal('timeline.threePointEdit', { assetId: 'insert', trackId: trackId('Music'), at: 0 })).toMatch(/can’t go on/)
    run('track.update', { id: trackId('Overlay'), patch: { locked: true } })
    expect(refusal('timeline.threePointEdit', { assetId: 'insert', trackId: trackId('Overlay'), at: 0 })).toMatch(/locked/)
    run('track.update', { id: trackId('Music'), patch: { rippleLock: true } })
    expect(refusal('timeline.threePointEdit', { assetId: 'song', trackId: trackId('Music'), at: 10, mode: 'insert' })).toMatch(/ripple-locked/)
  })
})