import { beforeEach, describe, expect, it, vi } from 'vitest'

// The transport runs on animation frames; here the test moves the playhead itself.
vi.stubGlobal('requestAnimationFrame', () => 0)
vi.stubGlobal('cancelAnimationFrame', () => {})

const { playback, usePlayback } = await import('./playback')
const { getProject, useEditor } = await import('./store')
const { add, addAsset, clip, freshProject, onTrack, run, spans, trackId } = await import('./test-helpers')
const { cutAt, nearestCut, refreshCut, trimLimits, trimSides, trimStep } = await import('./trim-mode')
const { enterTrim, exitTrim, handleTrimKey, nudgeTrim, setTrimSide, trimming, useTrim } = await import('./trim-session')
const { useUI } = await import('./ui-store')

let a: string
let b: string
let c: string

beforeEach(() => {
  exitTrim()
  playback.pause()
  freshProject('Trim')
  addAsset('long', 60)
  // Three clips on the main track, each with footage to spare either side.
  a = add('Main', 0, 100, { assetId: 'long', inPoint: 100 })
  b = add('Main', 100, 100, { assetId: 'long', inPoint: 600 })
  c = add('Main', 200, 100, { assetId: 'long', inPoint: 1100 })
  useUI.getState().clearSelection()
  playback.seek(0)
})

/** Plays from where the session parks the playhead, frame by frame, to `to`, and stops there. */
function playTo(to: number) {
  usePlayback.setState({ playing: true, rate: to >= usePlayback.getState().frame ? 1 : -1 })
  const from = usePlayback.getState().frame
  const dir = to >= from ? 1 : -1
  for (let f = from + dir; dir > 0 ? f <= to : f >= to; f += dir) {
    if (!usePlayback.getState().playing) break
    usePlayback.setState({ frame: f })
  }
  if (usePlayback.getState().playing) playback.pause()
}

const key = (k: string, shiftKey = false) => handleTrimKey({ key: k, shiftKey, ctrlKey: false, metaKey: false, altKey: false })
const history = () => useEditor.getState().past.map((e) => e.label)

describe('cuts', () => {
  it('are where a clip ends, another begins, or both', () => {
    const p = getProject()
    expect(cutAt(p, clip(b), 'start')).toEqual({ trackId: trackId('Main'), frame: 100, left: a, right: b })
    expect(cutAt(p, clip(c), 'end')).toEqual({ trackId: trackId('Main'), frame: 300, left: c })
    expect(trimSides(cutAt(p, clip(b), 'start'))).toEqual(['roll', 'out', 'in'])
    expect(trimSides(cutAt(p, clip(c), 'end'))).toEqual(['out'])
    const lone = add('Overlay', 50, 40, { assetId: 'long' })
    expect(trimSides(cutAt(getProject(), clip(lone), 'start'))).toEqual(['in'])
  })

  it('the nearest one is picked, a selected clip’s first, the main track’s among equals', () => {
    expect(nearestCut(getProject(), 130)?.frame).toBe(100)
    expect(nearestCut(getProject(), 160)?.frame).toBe(200)
    // The very start of the timeline is not a cut.
    expect(nearestCut(getProject(), 2)?.frame).toBe(100)
    const over = add('Overlay', 100, 50, { assetId: 'long' })
    expect(nearestCut(getProject(), 100)?.trackId).toBe(trackId('Main'))
    expect(nearestCut(getProject(), 190, [over])).toMatchObject({ trackId: trackId('Overlay'), frame: 150 })
    run('track.update', { id: trackId('Main'), patch: { locked: true } })
    expect(nearestCut(getProject(), 100)?.trackId).toBe(trackId('Overlay'))
  })

  it('can move as far as the footage on the side being trimmed allows', () => {
    const p = getProject()
    const cut = cutAt(p, clip(b), 'start')
    // Rolling: a keeps a frame, b keeps a frame.
    expect(trimLimits(p, cut, 'roll')).toEqual([1, 199])
    // a has 1600 frames of footage after its end; it can lose all but one frame.
    expect(trimLimits(p, cut, 'out')).toEqual([1, 1700])
    // b can start on any frame it has, and there is footage ahead of its in-point too.
    expect(trimLimits(p, cut, 'in')).toEqual([0, 199])
    expect(trimStep(p, cut, 'roll', 100)).toBeNull()
    expect(trimStep(p, cut, 'roll', 500)).toMatchObject({ command: 'clip.roll', frame: 199 })
    expect(trimStep(p, cut, 'out', 120)).toMatchObject({ command: 'clip.trim', input: { id: a, edge: 'end', frame: 120 } })
  })

  it('are found again after an edit, or known to be gone', () => {
    const cut = cutAt(getProject(), clip(b), 'start')
    run('clip.roll', { id: b, frame: 130 })
    expect(refreshCut(getProject(), cut)?.frame).toBe(130)
    run('clip.delete', { ids: [a] })
    expect(refreshCut(getProject(), cut)).toBeNull()
  })
})

describe('trimming while it plays', () => {
  it('rolls the cut to where playback stops, as one undo step', () => {
    playback.seek(110)
    expect(enterTrim()).toBe(true)
    expect(useTrim.getState()).toMatchObject({ side: 'roll', cut: { frame: 100 } })
    // The viewer waits on the outgoing shot's last frame, and the clips at the cut are selected.
    expect(usePlayback.getState().frame).toBe(99)
    expect(useUI.getState().selection).toEqual([a, b])
    const before = history().length
    playTo(129)
    // It stopped on frame 129: that is a's last frame now.
    expect(spans('Main')).toEqual([
      [0, 130],
      [130, 200],
      [200, 300],
    ])
    expect(clip(b).inPoint).toBe(630)
    expect(history().slice(before)).toEqual(['Roll the cut'])
    expect(usePlayback.getState().frame).toBe(129)
    expect(useTrim.getState().cut?.frame).toBe(130)
  })

  it('follows the playhead backwards too', () => {
    enterTrim(cutAt(getProject(), clip(b), 'start'))
    playTo(79)
    expect(spans('Main')[0]).toEqual([0, 80])
    expect(clip(b)).toMatchObject({ start: 80, inPoint: 580 })
  })

  it('trims the out side with everything after it following', () => {
    enterTrim(cutAt(getProject(), clip(b), 'start'), 'out')
    playTo(119)
    expect(spans('Main')).toEqual([
      [0, 120],
      [120, 220],
      [220, 320],
    ])
    // b itself is untouched.
    expect(clip(b).inPoint).toBe(600)
  })

  it('trims the in side to the frame it stops on', () => {
    enterTrim(cutAt(getProject(), clip(b), 'start'), 'in')
    // The viewer starts on the incoming shot's first frame.
    expect(usePlayback.getState().frame).toBe(100)
    playTo(124)
    // Nothing moved while it played; stopping on frame 124 made that b's first frame.
    expect(clip(b)).toMatchObject({ start: 100, duration: 76, inPoint: 624 })
    expect(clip(c).start).toBe(176)
    expect(usePlayback.getState().frame).toBe(100)
  })

  it('stops at the end of the footage', () => {
    addAsset('tight', 5)
    const d = add('Main', 300, 100, { assetId: 'tight', inPoint: 20 })
    const e = add('Main', 400, 100, { assetId: 'long' })
    // d has 30 frames of footage left after its end.
    enterTrim(cutAt(getProject(), clip(e), 'start'), 'out')
    playTo(600)
    expect(usePlayback.getState().playing).toBe(false)
    expect(clip(d).duration).toBe(130)
    expect(clip(e).start).toBe(430)
  })

  it('always sets off from the cut, wherever the playhead was left', () => {
    enterTrim(cutAt(getProject(), clip(b), 'start'))
    playback.seek(250)
    // (Shuttling, so the transport doesn't reach for a sound card that Node hasn't got.)
    usePlayback.setState({ playing: true, rate: 2 })
    expect(usePlayback.getState().frame).toBe(99)
    playback.pause()
    expect(spans('Main')[0]).toEqual([0, 100])
  })
})

describe('trim mode from the keyboard', () => {
  it('nudges with the arrows, a run of presses being one undo step', () => {
    enterTrim(cutAt(getProject(), clip(b), 'start'))
    const before = history().length
    expect(key('ArrowRight')).toBe(true)
    key('ArrowRight')
    key('ArrowRight', true)
    key('ArrowLeft')
    expect(useTrim.getState()).toMatchObject({ moved: 6, cut: { frame: 106 } })
    expect(spans('Main')[0]).toEqual([0, 106])
    expect(history().slice(before)).toEqual(['Roll the cut'])
    // The viewer sits on the outgoing shot's new last frame.
    expect(usePlayback.getState().frame).toBe(105)
    // Back where it started: nothing to undo.
    for (let i = 0; i < 6; i++) key('ArrowLeft')
    expect(history().length).toBe(before)
  })

  it('nudges the in side one frame of footage at a time', () => {
    enterTrim(cutAt(getProject(), clip(b), 'start'), 'in')
    key('ArrowRight')
    key('ArrowRight')
    expect(clip(b)).toMatchObject({ start: 100, duration: 98, inPoint: 602 })
    key('ArrowLeft', true)
    // Three frames before where it started: footage ahead of the old in-point.
    expect(clip(b)).toMatchObject({ start: 100, duration: 103, inPoint: 597 })
    expect(usePlayback.getState().frame).toBe(100)
  })

  it('K trims to the frame the playhead is on', () => {
    enterTrim(cutAt(getProject(), clip(b), 'start'), 'out')
    playback.seek(139)
    key('k')
    expect(spans('Main')[0]).toEqual([0, 140])
    setTrimSide('in')
    playback.seek(150)
    key('k')
    expect(clip(b).inPoint).toBe(610)
  })

  it('Tab goes round the sides the cut has, and Esc leaves', () => {
    enterTrim(cutAt(getProject(), clip(b), 'start'))
    key('Tab')
    expect(useTrim.getState().side).toBe('out')
    key('Tab')
    expect(useTrim.getState().side).toBe('in')
    expect(usePlayback.getState().frame).toBe(100)
    key('Tab')
    expect(useTrim.getState().side).toBe('roll')
    expect(key('j')).toBe(false)
    expect(key('Escape')).toBe(true)
    expect(trimming()).toBe(false)
    expect(key('k')).toBe(false)
  })

  it('carries on after an undo, and ends when its cut is gone', () => {
    enterTrim(cutAt(getProject(), clip(b), 'start'))
    nudgeTrim(10)
    useEditor.getState().undo()
    expect(useTrim.getState()).toMatchObject({ cut: { frame: 100 }, moved: 0 })
    nudgeTrim(4)
    expect(spans('Main')[0]).toEqual([0, 104])
    run('clip.delete', { ids: [b] })
    expect(trimming()).toBe(false)
  })

  it('has nothing to do on an empty timeline', () => {
    freshProject('Empty')
    expect(enterTrim()).toBe(false)
    expect(onTrack('Main')).toEqual([])
  })
})
