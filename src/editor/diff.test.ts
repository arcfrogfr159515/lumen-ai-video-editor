import { beforeEach, describe, expect, it } from 'vitest'
import { diffTimelines, hunkAt, mapFrame, pairTracks, type Hunk } from './diff'
import { branchesOf, openSequence, openSequenceId } from './sequences'
import { getProject, useEditor } from './store'
import { add, addAsset, clip, freshProject, onTrack, refusal, run, spans, trackId } from './test-helpers'

let main: string
let branch: string

beforeEach(() => {
  freshProject('Versions')
  addAsset('long', 120)
  addAsset('other', 120)
  addAsset('song', 300, 'audio')
  // Four shots on the main track, a title over the second, music under everything.
  ;['A', 'B', 'C', 'D'].forEach((name, i) => add('Main', i * 100, 100, { assetId: 'long', inPoint: i * 400, name }))
  add('Titles', 120, 60, { kind: 'text', name: 'Title' })
  add('Music', 0, 400, { assetId: 'song' })
  main = openSequenceId(getProject())
  // The branch opens: edits from here on are made on it.
  branch = run('sequence.branch', {}) as string
})

/** The stretches where the branch (open) differs from the timeline it came from. */
const diff = () => diffTimelines(getProject().sequences![main], openSequence(getProject()))
const hunks = () => diff().hunks.map((h) => [h.kind, ...h.a, ...h.b])
const named = (name: string) => onTrack('Main').find((c) => c.name === name)!
/** Opens the first timeline and takes a stretch from the branch into it. */
const take = (h: Hunk) => run('timeline.mergeFrom', { sequenceId: branch, a: { start: h.a[0], end: h.a[1] }, b: { start: h.b[0], end: h.b[1] } })
/** The stretches where the first timeline (open) differs from the branch. */
const left = () => diffTimelines(openSequence(getProject()), getProject().sequences![branch]).hunks

describe('a branch', () => {
  it('is a copy that knows where it came from', () => {
    const p = getProject()
    expect(openSequenceId(p)).toBe(branch)
    expect(p.sequence).toMatchObject({ name: 'Main timeline · branch', branchOf: { sequenceId: main } })
    // Its tracks are new, and each remembers the track it began as.
    const from = p.sequences![main]
    expect(p.tracks.map((t) => t.origin)).toEqual(from.tracks.map((t) => t.id))
    expect(p.tracks.every((t, i) => t.id !== from.tracks[i].id)).toBe(true)
    expect(branchesOf(p, main).map((s) => s.id)).toEqual([branch])
    // A branch of a branch still lines up with the first timeline.
    const second = run('sequence.branch', { open: false }) as string
    expect(getProject().sequences![second].tracks.map((t) => t.origin)).toEqual(from.tracks.map((t) => t.id))
    expect(branchesOf(getProject(), main).map((s) => s.id)).toEqual([branch, second])
  })

  it('plays the same as where it came from until something is changed', () => {
    expect(diff()).toMatchObject({ hunks: [], framesA: 0, framesB: 0, lengthA: 400, lengthB: 400 })
  })

  it('is not made different by a cut that changes nothing', () => {
    run('clip.split', { frame: 150 })
    run('clip.split', { frame: 333 })
    expect(onTrack('Main')).toHaveLength(6)
    expect(hunks()).toEqual([])
  })

  it('is not made different by a cut through a clip that comes in and goes out with an animation', () => {
    // The title fades in and out — in this version and in a second branch made of it, which is the open one from here.
    run('clip.update', { ids: [onTrack('Titles')[0].id], patch: { animation: { in: { preset: 'fade', duration: 8 }, out: { preset: 'fade', duration: 8 } } } })
    run('sequence.branch', {})
    const versions = () => diffTimelines(getProject().sequences![branch], openSequence(getProject())).hunks.map((h) => [h.kind, ...h.a, ...h.b])
    expect(versions()).toEqual([])
    // A cut leaves the fade in on the first piece and the fade out on the second: compared piece by piece, each
    // piece was a clip animated otherwise than the whole one, and the cut was a change.
    run('clip.split', { frame: 150 })
    expect(onTrack('Titles')).toHaveLength(2)
    expect(versions()).toEqual([])
  })

  it('finds an animation a clip comes in or goes out with, where it plays', () => {
    run('clip.update', { ids: [onTrack('Titles')[0].id], patch: { animation: { in: { preset: 'fade', duration: 8 } } } })
    expect(hunks()).toEqual([['changed', 120, 128, 120, 128]])
    run('clip.update', { ids: [onTrack('Titles')[0].id], patch: { animation: { out: { preset: 'rise', duration: 6 } } } })
    expect(hunks()).toEqual([
      ['changed', 120, 128, 120, 128],
      ['changed', 174, 180, 174, 180],
    ])
  })

  it('finds a fade of a clip’s sound, where it plays', () => {
    // A fade wasn't among what was compared: with one, the two versions were said to play the same.
    run('clip.update', { ids: [named('D').id], patch: { audio: { fadeOut: 20 } } })
    expect(hunks()).toEqual([['changed', 380, 400, 380, 400]])
    run('clip.update', { ids: [named('A').id], patch: { audio: { fadeIn: 12 } } })
    expect(hunks()).toEqual([
      ['changed', 0, 12, 0, 12],
      ['changed', 380, 400, 380, 400],
    ])
  })

  it('is not made different by a cut through a clip whose sound fades in and out', () => {
    run('clip.update', { ids: [named('B').id], patch: { audio: { fadeIn: 10, fadeOut: 10 } } })
    run('sequence.branch', {})
    const versions = () => diffTimelines(getProject().sequences![branch], openSequence(getProject())).hunks.map((h) => [h.kind, ...h.a, ...h.b])
    expect(versions()).toEqual([])
    // A cut leaves the fade in on the first piece and the fade out on the second.
    run('clip.split', { frame: 150 })
    expect(versions()).toEqual([])
  })

  it('finds a move of the picture made with keyframes, on the frames where it differs', () => {
    // Only the speed's keyframes were compared: a push in over a shot was no difference.
    const b = named('B').id
    run('keyframe.set', { clipId: b, prop: 'scale', frame: 20, value: 1, easing: 'linear' })
    run('keyframe.set', { clipId: b, prop: 'scale', frame: 60, value: 1.4, easing: 'linear' })
    // Up to its twentieth frame the shot is as large as it was; from there on it isn't.
    expect(hunks()).toEqual([['changed', 121, 200, 121, 200]])
  })

  it('is not made different by keyframes that leave the picture where it was', () => {
    const b = named('B').id
    run('keyframe.set', { clipId: b, prop: 'scale', frame: 0, value: 1, easing: 'linear' })
    run('keyframe.set', { clipId: b, prop: 'opacity', frame: 30, value: 1, easing: 'linear' })
    expect(hunks()).toEqual([])
  })

  it('is not made different by a cut through a clip whose picture moves', () => {
    const b = named('B').id
    run('keyframe.set', { clipId: b, prop: 'scale', frame: 0, value: 1, easing: 'linear' })
    run('keyframe.set', { clipId: b, prop: 'scale', frame: 80, value: 1.4, easing: 'linear' })
    run('keyframe.set', { clipId: b, prop: 'volume', frame: 10, value: -12, easing: 'linear' })
    run('sequence.branch', {})
    const versions = () => diffTimelines(getProject().sequences![branch], openSequence(getProject())).hunks.map((h) => [h.kind, ...h.a, ...h.b])
    expect(versions()).toEqual([])
    // A cut gives each piece keyframes of its own, with one at the cut: the picture moves as it did.
    run('clip.split', { frame: 150 })
    expect(versions()).toEqual([])
  })

  it('a shot made steady counts', () => {
    // Whether a clip is stabilised, and how, wasn't among what was compared.
    const steady = { start: 0, rate: 30, path: [0, 0, 0, 0.01, 0.002, 0.001, 0.02, 0.001, 0], smooth: 1, zoom: 1.08, rotation: false }
    run('clip.update', { ids: [named('B').id], patch: { stabilize: steady } })
    expect(hunks()).toEqual([['changed', 100, 200, 100, 200]])
    // It is measured along the footage: a cut through the clip leaves it on both pieces, and changes nothing.
    run('clip.split', { frame: 150 })
    expect(hunks()).toEqual([['changed', 100, 200, 100, 200]])
    // Steadier than before is another difference than steady at all.
    run('sequence.branch', {})
    const versions = () => diffTimelines(getProject().sequences![branch], openSequence(getProject())).hunks.map((h) => [h.kind, ...h.a, ...h.b])
    expect(versions()).toEqual([])
    run('clip.update', { ids: [onTrack('Main').find((c) => c.start === 100)!.id], patch: { stabilize: { smooth: 3 } } })
    expect(versions()).toEqual([['changed', 100, 150, 100, 150]])
  })

  it('finds a clip made to follow something, from where it begins to move', () => {
    // The path a clip follows wasn't among what was compared.
    // From its tenth frame the point it follows moves, by (10, 5) a frame for three frames, and stops.
    run('clip.update', { ids: [named('B').id], patch: { follow: { start: 10, ref: 0, points: [0, 0, 10, 5, 20, 10, 30, 15] } } })
    expect(hunks()).toEqual([['changed', 111, 200, 111, 200]])
  })

  it('is not made different by a cut through a clip that follows something, or whose mask does', () => {
    const b = named('B').id
    const path = { start: 10, ref: 0, points: [0, 0, 10, 5, 20, 10, 30, 15] }
    run('clip.update', { ids: [b], patch: { follow: path } })
    run('mask.add', { clipId: b, mask: { shape: 'ellipse', follow: { start: 20, ref: 0, points: [0.5, 0.5, 0.52, 0.5, 0.56, 0.48] } } })
    run('sequence.branch', {})
    const versions = () => diffTimelines(getProject().sequences![branch], openSequence(getProject())).hunks.map((h) => [h.kind, ...h.a, ...h.b])
    expect(versions()).toEqual([])
    // A cut moves the start of each path on the second piece, where it is counted from that piece's first frame:
    // a mask's path was compared as it is written, clip by clip, and the cut was a change.
    run('clip.split', { frame: 150 })
    expect(versions()).toEqual([])
  })

  it('finds a mask made to follow something, from where it begins to move', () => {
    const b = named('B').id
    const maskId = run('mask.add', { clipId: b, mask: { shape: 'ellipse' } }) as string
    run('sequence.branch', {})
    const versions = () => diffTimelines(getProject().sequences![branch], openSequence(getProject())).hunks.map((h) => [h.kind, ...h.a, ...h.b])
    const now = onTrack('Main').find((c) => c.start === 100)!
    run('mask.update', { clipId: now.id, maskId: now.masks![0].id, patch: { follow: { start: 20, ref: 0, points: [0.5, 0.5, 0.52, 0.5, 0.56, 0.48] } } })
    expect(maskId).toBeTruthy()
    expect(versions()).toEqual([['changed', 121, 200, 121, 200]])
  })

  it('finds a transition into a clip, on the frames it plays over', () => {
    // A transition wasn't among what was compared: with one, the two versions were said to play the same.
    run('clip.setTransition', { id: named('C').id, transition: { kind: 'dissolve', duration: 12 } })
    expect(hunks()).toEqual([['changed', 200, 212, 200, 212]])
    // Set to straddle the cut, it plays over the end of the clip before as well.
    run('clip.setTransition', { id: named('C').id, transition: { kind: 'dissolve', duration: 12, align: 'center' } })
    expect(hunks()).toEqual([['changed', 194, 206, 194, 206]])
  })

  it('is not made different by a cut through either clip of a transition', () => {
    run('clip.setTransition', { id: named('C').id, transition: { kind: 'dissolve', duration: 12, align: 'center' } })
    run('sequence.branch', {})
    const versions = () => diffTimelines(getProject().sequences![branch], openSequence(getProject())).hunks.map((h) => [h.kind, ...h.a, ...h.b])
    expect(versions()).toEqual([])
    // The transition stays on the first piece of the clip it leads into, and the clip before still touches it.
    run('clip.split', { frame: 150 })
    run('clip.split', { frame: 250 })
    expect(versions()).toEqual([])
  })

  it('finds a cut that stops an animation short', () => {
    run('clip.update', { ids: [onTrack('Titles')[0].id], patch: { animation: { in: { preset: 'fade', duration: 8 } } } })
    run('sequence.branch', {})
    const versions = () => diffTimelines(getProject().sequences![branch], openSequence(getProject())).hunks.map((h) => [h.kind, ...h.a, ...h.b])
    // Three frames into a fade of eight: the second piece doesn't fade, so the last five frames of it are gone.
    run('clip.split', { frame: 123 })
    expect(versions()).toEqual([['changed', 123, 128, 123, 128]])
  })
})

describe('where two versions differ', () => {
  it('a clip trimmed shorter is a stretch one version has and the other hasn’t', () => {
    run('clip.trim', { id: named('B').id, edge: 'end', frame: 180 })
    // The main track closed up, so the branch is 20 frames shorter; the title and music didn't move.
    expect(spans('Main').at(-1)).toEqual([280, 380])
    const d = diff()
    // What follows the trim on the main track now plays 20 frames earlier against the title and music: from the
    // trim onward the versions differ until they both run out.
    expect(d.hunks[0].a[0]).toBe(180)
    expect(d.hunks[0].b[0]).toBe(180)
  })

  it('a stretch taken out of every track is exactly that stretch', () => {
    run('timeline.removeRange', { start: 220, end: 260 })
    expect(hunks()).toEqual([['removed', 220, 260, 220, 220]])
    expect(diff()).toMatchObject({ framesA: 40, framesB: 0, lengthA: 400, lengthB: 360 })
  })

  it('different footage in the same place is a changed stretch of the same length', () => {
    run('clip.slip', { id: named('C').id, frames: 55 })
    expect(hunks()).toEqual([['changed', 200, 300, 200, 300]])
  })

  it('a grade, an effect or a move of the picture counts', () => {
    run('clip.update', { ids: [named('A').id], patch: { color: { exposure: 30 } } })
    run('effect.add', { ids: [named('D').id], kind: 'grain' })
    expect(hunks()).toEqual([
      ['changed', 0, 100, 0, 100],
      ['changed', 300, 400, 300, 400],
    ])
  })

  it('a look put on a clip counts', () => {
    // The look a clip wears wasn't among what was compared: the two versions were said to play the same.
    run('clip.update', { ids: [named('B').id], patch: { look: 'cinematic' } })
    expect(hunks()).toEqual([['changed', 100, 200, 100, 200]])
    // And a cut through the clip that wears it still changes nothing.
    run('clip.split', { frame: 150 })
    expect(hunks()).toEqual([['changed', 100, 200, 100, 200]])
  })

  it('finds each difference where it is, in order, however the lengths shifted between', () => {
    // Early on, 30 frames come out of everything; later a new shot goes in on every track in sync.
    run('timeline.removeRange', { start: 40, end: 70 })
    run('timeline.threePointEdit', { assetId: 'other', trackId: trackId('Main'), at: 270, sourceIn: 0, sourceOut: 50, mode: 'insert' })
    const d = diff()
    expect(d.hunks.map((h) => [h.kind, ...h.a, ...h.b])).toEqual([
      ['removed', 40, 70, 40, 40],
      ['added', 300, 300, 270, 320],
    ])
    // A moment after both: 30 frames earlier for the first, 50 later for the second.
    expect(mapFrame(d, 350)).toBe(370)
    expect(mapFrame(d, 370, 'b')).toBe(350)
    expect(mapFrame(d, 20)).toBe(20)
    expect(mapFrame(d, 100)).toBe(70)
    // Inside a stretch the other version doesn't have, it maps to where that stretch would be.
    expect(mapFrame(d, 55)).toBe(40)
    expect(hunkAt(d, 55)?.kind).toBe('removed')
    expect(hunkAt(d, 300)?.kind).toBe('added')
    expect(hunkAt(d, 290, 'b')?.kind).toBe('added')
    expect(hunkAt(d, 200)).toBeUndefined()
  })

  it('finds what two versions still share between two differences', () => {
    // B gets other footage, and the clip after it loses its last 30 frames: C's first 70 frames are the same in both.
    run('clip.slip', { id: named('B').id, frames: 40 })
    run('timeline.removeRange', { start: 270, end: 300 })
    expect(hunks()).toEqual([
      ['changed', 100, 200, 100, 200],
      ['removed', 270, 300, 270, 270],
    ])
  })

  it('narrows a difference to the frames that differ', () => {
    // The last 15 frames of A are replaced by other footage.
    run('timeline.threePointEdit', { assetId: 'other', trackId: trackId('Main'), at: 85, sourceIn: 0, sourceOut: 15, mode: 'overwrite' })
    expect(hunks()).toEqual([['changed', 85, 100, 85, 100]])
  })

  it('lines tracks up by what they began as, then by kind and name', () => {
    const p = getProject()
    const from = p.sequences![main]
    run('track.move', { id: trackId('Titles'), index: 1 })
    const pairs = pairTracks(from.tracks, getProject().tracks)
    expect(pairs.every(([a, b]) => a && b && b.origin === a.id)).toBe(true)
    // Unrelated timelines: by kind, role and name.
    const other = run('sequence.create', { open: false }) as string
    const names = pairTracks(from.tracks, getProject().sequences![other].tracks).map(([a, b]) => [a?.name, b?.name])
    expect(names).toEqual(from.tracks.map((t) => [t.name, t.name]))
  })

  it('still finds its way through timelines too long to line up cut by cut', () => {
    // 6,000 one-frame shots, the same in both versions but for one in the middle.
    freshProject('Long')
    addAsset('long', 600)
    const tracks = getProject().tracks
    const mainTrack = tracks.find((t) => t.name === 'Main')!.id
    const shots = (odd: number) =>
      Object.fromEntries(
        Array.from({ length: 6000 }, (_, i) => {
          const id = `c${i}`
          return [id, { ...clip0, id, trackId: mainTrack, start: i, duration: 1, inPoint: i === odd ? 9000 : i * 2 }]
        }),
      )
    const base = add('Main', 0, 1, { assetId: 'long' })
    const clip0 = getProject().clips[base]
    const settings = getProject().settings
    const d = diffTimelines({ tracks, clips: shots(-1), settings }, { tracks, clips: shots(3000), settings })
    expect(d.hunks.map((h) => [h.kind, ...h.a, ...h.b])).toEqual([['changed', 3000, 3001, 3000, 3001]])
  })
})

describe('taking a stretch from one version into the other', () => {  it('makes the two play the same there, everything after staying in step', () => {
    run('clip.slip', { id: named('C').id, frames: 55 })
    run('timeline.removeRange', { start: 40, end: 70 })
    run('sequence.open', { id: main })
    const before = left()
    expect(before.map((h) => h.kind)).toEqual(['removed', 'changed'])
    // The later stretch first, so the earlier one is still where it was found.
    take(before[1])
    expect(left().map((h) => h.kind)).toEqual(['removed'])
    expect(named('C').inPoint).toBe(855)
    take(left()[0])
    expect(left()).toEqual([])
    expect(spans('Main').at(-1)).toEqual([270, 370])
    expect(spans('Titles')).toEqual([[90, 150]])
  })

  it('brings a fade and an animation across, each on the frames it plays over', () => {
    run('clip.update', { ids: [named('D').id], patch: { audio: { fadeOut: 20 } } })
    run('clip.update', { ids: [onTrack('Titles')[0].id], patch: { animation: { in: { preset: 'fade', duration: 8 } } } })
    run('sequence.open', { id: main })
    const before = left()
    expect(before.map((h) => [h.kind, ...h.a])).toEqual([
      ['changed', 120, 128],
      ['changed', 380, 400],
    ])
    // The later stretch first, so the earlier one is still where it was found.
    take(before[1])
    take(left()[0])
    expect(left()).toEqual([])
  })

  it('brings what a clip follows across, from where it begins to move', () => {
    run('clip.update', { ids: [named('B').id], patch: { follow: { start: 10, ref: 0, points: [0, 0, 10, 5, 20, 10, 30, 15] } } })
    run('sequence.open', { id: main })
    const before = left()
    expect(before.map((h) => [h.kind, ...h.a])).toEqual([['changed', 111, 200]])
    take(before[0])
    expect(left()).toEqual([])
  })

  it('brings a transition across, with both sides of its cut', () => {
    run('clip.setTransition', { id: named('C').id, transition: { kind: 'dissolve', duration: 12, align: 'center' } })
    run('sequence.open', { id: main })
    const before = left()
    expect(before.map((h) => [h.kind, ...h.a])).toEqual([['changed', 194, 206]])
    take(before[0])
    expect(left()).toEqual([])
  })

  it('brings a move of the picture across, from where it begins', () => {
    const b = named('B').id
    run('keyframe.set', { clipId: b, prop: 'scale', frame: 20, value: 1, easing: 'linear' })
    run('keyframe.set', { clipId: b, prop: 'scale', frame: 60, value: 1.4, easing: 'linear' })
    run('sequence.open', { id: main })
    const before = left()
    expect(before.map((h) => [h.kind, ...h.a])).toEqual([['changed', 121, 200]])
    // What is taken begins part-way through the push in: it goes on from there, as it does in the branch.
    take(before[0])
    expect(left()).toEqual([])
  })

  it('brings a stretch the other version added, with what is over it', () => {
    run('timeline.threePointEdit', { assetId: 'other', trackId: trackId('Main'), at: 200, sourceIn: 30, sourceOut: 90, mode: 'insert' })
    add('Titles', 210, 40, { kind: 'text', name: 'New title' })
    run('marker.add', { frame: 205, kind: 'chapter', label: 'New part' })
    run('sequence.open', { id: main })
    const [h] = left()
    expect([h.kind, ...h.a, ...h.b]).toEqual(['added', 200, 200, 200, 260])
    const r = take(h) as { clipIds: string[] }
    expect(r.clipIds).toHaveLength(2)
    expect(left()).toEqual([])
    expect(spans('Main')).toEqual([
      [0, 100],
      [100, 200],
      [200, 260],
      [260, 360],
      [360, 460],
    ])
    expect(onTrack('Titles').map((c) => [c.name, c.start])).toEqual([
      ['Title', 120],
      ['New title', 210],
    ])
    expect(getProject().markers.map((m) => [m.label, m.frame])).toEqual([['New part', 205]])
    // The copies are new clips: the branch still has its own.
    expect(r.clipIds.every((id) => !getProject().sequences![branch].clips[id])).toBe(true)
  })

  it('adds a track the other version has and this one hasn’t', () => {
    const extra = run('track.add', { kind: 'video', name: 'Graphics' }) as string
    run('clip.add', { trackId: extra, kind: 'video', start: 50, duration: 80, assetId: 'other' })
    run('sequence.open', { id: main })
    expect(getProject().tracks.some((t) => t.name === 'Graphics')).toBe(false)
    const [h] = left()
    take(h)
    expect(spans('Graphics')).toEqual([[50, 130]])
    expect(left()).toEqual([])
  })

  it('is one undo step, and refuses a timeline at another frame rate', () => {
    run('clip.slip', { id: named('C').id, frames: 55 })
    run('sequence.open', { id: main })
    const steps = useEditor.getState().past.length
    take(left()[0])
    expect(useEditor.getState().past.length).toBe(steps + 1)
    expect(useEditor.getState().past.at(-1)!.label).toBe('Take a stretch from Main timeline · branch')
    useEditor.getState().undo()
    expect(named('C').inPoint).toBe(800)
    expect(refusal('timeline.mergeFrom', { sequenceId: main, a: { start: 0, end: 10 }, b: { start: 0, end: 10 } })).toMatch(/open timeline/)
    const fast = run('sequence.create', { settings: { fps: 60 }, open: false }) as string
    expect(refusal('timeline.mergeFrom', { sequenceId: fast, a: { start: 0, end: 10 }, b: { start: 0, end: 10 } })).toMatch(/fps/)
    expect(clip(named('A').id).name).toBe('A')
  })
})
