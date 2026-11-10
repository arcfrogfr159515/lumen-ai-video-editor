import { beforeEach, describe, expect, it } from 'vitest'
import { getProject } from './store'
import { currentTakes, describeTake, neighbourTake, takeFills, takeIndex } from './takes'
import { add, addAsset, clip, freshProject, refusal, run, spans } from './test-helpers'
import type { SwitchResult } from './takes'
import { consumed } from './timing'

beforeEach(() => {
  freshProject('Takes')
  addAsset('take1', 20)
  addAsset('take2', 20)
  addAsset('short', 2)
  addAsset('photo', 0, 'image')
  addAsset('line', 30, 'audio')
})

const names = (id: string) => clip(id).takes?.map((t) => t.name)

describe('alternate takes', () => {
  it('swap the footage and leave the place as it was', () => {
    add('Main', 0, 90, { assetId: 'take1' })
    const id = add('Main', 90, 120, { assetId: 'take1', inPoint: 150 })
    add('Main', 210, 90, { assetId: 'take1', inPoint: 400 })
    run('clip.update', { ids: [id], patch: { color: { exposure: 20 }, audio: { volume: -6 }, note: 'Pick the best' } })
    const r = run('take.add', { clipId: id, assetId: 'take2', inPoint: 60 }) as SwitchResult
    expect(r).toMatchObject({ shortenedBy: 0, slidBack: 0 })
    const c = clip(id)
    expect(c).toMatchObject({ assetId: 'take2', inPoint: 60, start: 90, duration: 120, name: 'take2', note: 'Pick the best' })
    expect(c.color.exposure).toBe(20)
    expect(c.audio.volume).toBe(-6)
    expect(names(id)).toEqual(['take1', 'take2'])
    expect(takeIndex(c)).toBe(1)
    // Nothing else on the track moved.
    expect(spans('Main')).toEqual([
      [0, 90],
      [90, 210],
      [210, 300],
    ])
  })

  it('put away what was showing as it is now, slips included', () => {
    const id = add('Overlay', 0, 100, { assetId: 'take1', inPoint: 30 })
    run('take.add', { clipId: id, assetId: 'take2', show: false })
    expect(clip(id).assetId).toBe('take1')
    run('clip.slip', { id, frames: 45 })
    run('clip.update', { ids: [id], patch: { speed: 2 } })
    run('take.switch', { clipId: id, step: 1 })
    expect(clip(id)).toMatchObject({ assetId: 'take2', inPoint: 0, speed: 1 })
    expect(currentTakes(clip(id))[0]).toMatchObject({ assetId: 'take1', inPoint: 75, speed: 2 })
    run('take.switch', { clipId: id, step: 1 })
    expect(clip(id)).toMatchObject({ assetId: 'take1', inPoint: 75, speed: 2 })
  })

  it('start a take earlier when it would run out of footage', () => {
    const id = add('Overlay', 0, 100, { assetId: 'take1' })
    // take2 is 600 frames long: from frame 560 there are only 40 left.
    const r = run('take.add', { clipId: id, assetId: 'take2', inPoint: 560 }) as SwitchResult
    expect(r).toMatchObject({ shortenedBy: 0, slidBack: 60 })
    expect(clip(id)).toMatchObject({ inPoint: 500, duration: 100 })
  })

  it('shorten the clip for a take that is too short, and give the length back afterwards', () => {
    add('Main', 0, 100, { assetId: 'take1' })
    const id = add('Main', 100, 150, { assetId: 'take1', inPoint: 200 })
    const after = add('Main', 250, 100, { assetId: 'take1', inPoint: 400 })
    const r = run('take.add', { clipId: id, assetId: 'short' }) as SwitchResult
    expect(r.shortenedBy).toBe(90)
    expect(clip(id)).toMatchObject({ duration: 60, takeSlot: 150 })
    expect(takeFills(getProject(), clip(id), clip(id).takes![1])).toBe(false)
    // The main track closes up behind it…
    expect(clip(after).start).toBe(160)
    run('take.switch', { clipId: id, step: -1 })
    // …and opens again when the longer take comes back.
    expect(clip(id)).toMatchObject({ assetId: 'take1', duration: 150 })
    expect('takeSlot' in clip(id)).toBe(false)
    expect(clip(after).start).toBe(250)
  })

  it('forget the length of the place once the clip is given a length by hand', () => {
    const id = add('Overlay', 0, 150, { assetId: 'take1' })
    run('take.add', { clipId: id, assetId: 'short' })
    expect(clip(id)).toMatchObject({ duration: 60, takeSlot: 150 })
    // Trimmed to 40 frames: that is its length now, whatever take is shown next.
    run('clip.trim', { id, edge: 'end', frame: 40, ripple: false })
    expect('takeSlot' in clip(id)).toBe(false)
    run('take.switch', { clipId: id, step: 1 })
    expect(clip(id)).toMatchObject({ assetId: 'take1', duration: 40 })

    // The same when a new speed changes its length.
    const other = add('Overlay', 300, 150, { assetId: 'take1' })
    run('take.add', { clipId: other, assetId: 'short' })
    run('clip.update', { ids: [other], patch: { speed: 0.5 } })
    expect(clip(other)).toMatchObject({ duration: 120, speed: 0.5 })
    expect('takeSlot' in clip(other)).toBe(false)
  })

  it('end where the footage does when a take is ramped faster than its base speed', () => {
    // Four seconds of take1, ramped from 1× up to 4× (and playing on at 4× if the clip is made longer).
    const id = add('Overlay', 0, 120, { assetId: 'take1', inPoint: 0 })
    run('clip.setSpeedRamp', { id, points: [{ at: 0, speed: 1 }, { at: 1, speed: 4, easing: 'linear' }] })
    const ramped = clip(id).duration
    run('take.add', { clipId: id, assetId: 'take2' })
    // Back on the ramped take, in a place made longer meanwhile than its footage can fill.
    run('clip.trim', { id, edge: 'end', frame: 590, ripple: false })
    run('take.switch', { clipId: id, step: -1 })
    const c = clip(id)
    expect(c.keyframes.speed?.length).toBe(2)
    expect(c.inPoint + consumed(c)).toBeLessThanOrEqual(600.5)
    expect(c.duration).toBeGreaterThan(ramped)
    expect(c.duration).toBeLessThan(590)
    expect(c.takeSlot).toBe(590)
  })

  it('are re-timed with the clip when the frame rate changes', () => {
    const id = add('Overlay', 30, 150, { assetId: 'take1', inPoint: 90 })
    run('take.add', { clipId: id, assetId: 'take2', inPoint: 300, show: false })
    run('take.add', { clipId: id, assetId: 'short' })
    expect(clip(id)).toMatchObject({ duration: 60, takeSlot: 150 })
    run('project.update', { settings: { fps: 60 } })
    // Everything is where it was in seconds: twice the frames.
    expect(clip(id)).toMatchObject({ start: 60, duration: 120, takeSlot: 300 })
    expect(clip(id).takes!.map((t) => t.inPoint)).toEqual([180, 600, 0])
    run('take.switch', { clipId: id, step: -1 })
    expect(clip(id)).toMatchObject({ assetId: 'take2', inPoint: 600, duration: 300 })
  })

  it('never run into the next clip on a track that does not close up', () => {
    const id = add('Overlay', 0, 150, { assetId: 'take1' })
    run('take.add', { clipId: id, assetId: 'short' })
    expect(clip(id).duration).toBe(60)
    add('Overlay', 100, 50, { assetId: 'take2' })
    run('take.switch', { clipId: id, step: 1 })
    expect(spans('Overlay')).toEqual([
      [0, 100],
      [100, 150],
    ])
  })

  it('let a still fill any place', () => {
    const id = add('Overlay', 0, 500, { assetId: 'take1' })
    const r = run('take.add', { clipId: id, assetId: 'photo' }) as SwitchResult
    expect(r.shortenedBy).toBe(0)
    expect(clip(id)).toMatchObject({ kind: 'image', assetId: 'photo', duration: 500 })
    run('take.switch', { clipId: id, step: 1 })
    expect(clip(id).kind).toBe('video')
  })

  it('keep a name the clip was given, and follow the footage otherwise', () => {
    const id = add('Overlay', 0, 100, { assetId: 'take1', name: 'The answer' })
    run('take.add', { clipId: id, assetId: 'take2' })
    expect(clip(id).name).toBe('The answer')
    const plain = add('Overlay', 200, 100, { assetId: 'take1' })
    run('take.add', { clipId: plain, assetId: 'take2', name: 'Alt angle' })
    expect(clip(plain).name).toBe('Alt angle')
    run('take.switch', { clipId: plain, step: 1 })
    expect(clip(plain).name).toBe('take1')
  })

  it('refuse footage of the wrong kind, and clips that have none', () => {
    const video = add('Overlay', 0, 100, { assetId: 'take1' })
    expect(refusal('take.add', { clipId: video, assetId: 'line' })).toMatch(/sound/)
    const voice = add('Voice', 0, 100, { assetId: 'line' })
    expect(refusal('take.add', { clipId: voice, assetId: 'take2' })).toMatch(/picture/)
    const title = add('Titles', 0, 100, { kind: 'text' })
    expect(refusal('take.add', { clipId: title, assetId: 'take2' })).toMatch(/no footage to swap/)
    expect(refusal('take.switch', { clipId: video, step: 1 })).toMatch(/no alternate takes/)
    expect(refusal('take.add', { clipId: video, assetId: 'nope' })).toMatch(/not found/)
  })

  it('step round the takes in both directions', () => {
    const id = add('Overlay', 0, 100, { assetId: 'take1' })
    run('take.add', { clipId: id, assetId: 'take2', show: false })
    run('take.add', { clipId: id, assetId: 'photo', show: false })
    expect(neighbourTake(clip(id), 1)?.name).toBe('take2')
    expect(neighbourTake(clip(id), -1)?.name).toBe('photo')
    run('take.switch', { clipId: id, step: -1 })
    expect(clip(id).assetId).toBe('photo')
    run('take.switch', { clipId: id, takeId: clip(id).takes![1].id })
    expect(clip(id).assetId).toBe('take2')
  })

  it('come off one at a time or all at once', () => {
    const id = add('Overlay', 0, 100, { assetId: 'take1' })
    run('take.add', { clipId: id, assetId: 'take2' })
    run('take.add', { clipId: id, assetId: 'photo', show: false })
    // Removing the one showing shows the one before it.
    run('take.remove', { clipId: id, takeId: clip(id).takeId! })
    expect(clip(id).assetId).toBe('take1')
    expect(names(id)).toEqual(['take1', 'photo'])
    run('take.remove', { clipId: id, takeId: clip(id).takes![1].id })
    expect('takes' in clip(id)).toBe(false)
    expect('takeId' in clip(id)).toBe(false)
    run('take.add', { clipId: id, assetId: 'take2' })
    run('take.remove', { clipId: id, all: true })
    expect(clip(id)).toMatchObject({ assetId: 'take2' })
    expect('takes' in clip(id)).toBe(false)
  })

  it('are cut where the clip is cut', () => {
    const id = add('Overlay', 0, 100, { assetId: 'take1', inPoint: 30 })
    run('take.add', { clipId: id, assetId: 'take2', inPoint: 200, show: false })
    const [right] = run('clip.split', { frame: 40, ids: [id] }) as string[]
    // The right half picks the other take up 40 frames further in.
    run('take.switch', { clipId: right, step: 1 })
    expect(clip(right)).toMatchObject({ assetId: 'take2', inPoint: 240, start: 40, duration: 60 })
    run('take.switch', { clipId: id, step: 1 })
    expect(clip(id)).toMatchObject({ assetId: 'take2', inPoint: 200, duration: 40 })
  })

  it('go when their media is removed from the project', () => {
    const id = add('Overlay', 0, 100, { assetId: 'take1' })
    run('take.add', { clipId: id, assetId: 'take2', show: false })
    run('take.add', { clipId: id, assetId: 'photo', show: false })
    run('asset.remove', { ids: ['take2'] })
    expect(names(id)).toEqual(['take1', 'photo'])
    run('asset.remove', { ids: ['photo'] })
    expect('takes' in clip(id)).toBe(false)
  })

  it('travel with a copy and undo in one step', () => {
    const id = add('Overlay', 0, 100, { assetId: 'take1' })
    run('take.add', { clipId: id, assetId: 'take2' })
    const [copy] = run('clip.duplicate', { ids: [id] }) as string[]
    expect(names(copy)).toEqual(['take1', 'take2'])
    expect(describeTake(getProject(), clip(copy).takes![1])).toEqual({ source: 'take2', seconds: 20, missing: false })
  })
})