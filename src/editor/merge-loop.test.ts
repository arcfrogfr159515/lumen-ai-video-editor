import { beforeEach, describe, expect, it } from 'vitest'
import { nestedIn, openSequenceId } from './sequences'
import { getProject } from './store'
import { add, addAsset, freshProject, onTrack, refusal, run, trackId } from './test-helpers'

// A branch may be given a clip that plays the timeline it was branched from: nothing there plays the branch. Taking
// the stretch with that clip back into the timeline would have the timeline play itself.

let film: string
let branch: string

beforeEach(() => {
  freshProject('Branches')
  addAsset('a', 60)
  addAsset('b', 60)
  film = openSequenceId(getProject())
  add('Main', 0, 300, { assetId: 'a', name: 'shot' })
  branch = run('sequence.branch', {}) as string
  expect(openSequenceId(getProject())).toBe(branch)
})

const loops = () => nestedIn(getProject(), film).has(film)

describe('taking a stretch from another timeline', () => {
  it('brings a cutaway over as before', () => {
    add('Overlay', 30, 60, { assetId: 'b', name: 'cutaway' })
    run('sequence.open', { id: film })
    run('timeline.mergeFrom', { sequenceId: branch, a: { start: 0, end: 120 }, b: { start: 0, end: 120 } })
    expect(onTrack('Overlay').map((c) => c.name)).toEqual(['cutaway'])
    expect(loops()).toBe(false)
  })

  it('refuses a stretch with a clip that plays the timeline it is taken into', () => {
    // On the branch, a picture-in-picture of the film it came from.
    run('clip.add', { trackId: trackId('Overlay'), kind: 'video', start: 30, duration: 60, sequenceId: film, name: 'the film, small' })
    run('sequence.open', { id: film })
    // It came over: the film then had a clip that plays the film.
    expect(refusal('timeline.mergeFrom', { sequenceId: branch, a: { start: 0, end: 120 }, b: { start: 0, end: 120 } })).toMatch(/loop/)
    expect(onTrack('Overlay')).toEqual([])
    expect(loops()).toBe(false)
  })

  it('refuses one whose clip plays a timeline that contains the one it is taken into', () => {
    // A third timeline that plays the film; the branch plays that.
    const third = run('sequence.create', { name: 'Trailer' }) as string
    run('clip.add', { trackId: trackId('Main'), kind: 'video', start: 0, duration: 60, sequenceId: film })
    run('sequence.open', { id: branch })
    run('clip.add', { trackId: trackId('Overlay'), kind: 'video', start: 30, duration: 60, sequenceId: third, name: 'the trailer' })
    run('sequence.open', { id: film })
    expect(refusal('timeline.mergeFrom', { sequenceId: branch, a: { start: 0, end: 120 }, b: { start: 0, end: 120 } })).toMatch(/loop/)
    expect(loops()).toBe(false)
  })

  it('takes a stretch beside such a clip, which doesn’t come with it', () => {
    run('clip.add', { trackId: trackId('Overlay'), kind: 'video', start: 200, duration: 60, sequenceId: film, name: 'the film, small' })
    add('Overlay', 30, 60, { assetId: 'b', name: 'cutaway' })
    run('sequence.open', { id: film })
    run('timeline.mergeFrom', { sequenceId: branch, a: { start: 0, end: 120 }, b: { start: 0, end: 120 } })
    expect(onTrack('Overlay').map((c) => c.name)).toEqual(['cutaway'])
    expect(loops()).toBe(false)
  })
})
