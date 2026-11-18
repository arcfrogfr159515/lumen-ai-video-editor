import { beforeEach, describe, expect, it } from 'vitest'
import { copyClips, pasteClips } from './clipboard'
import { clipEnd } from './ops'
import { getProject } from './store'
import { add, addAsset, clip, freshProject, run } from './test-helpers'
import type { Clip } from './types'

// A clip is kept in frames of the timeline it is on: how long it is, where in its footage it starts, where its
// keyframes are. Copied on a timeline at one frame rate and pasted on one at another, it is the same clip — as long
// in seconds, from the same moment of its footage.

/** A two-second clip from ten seconds into its footage, with a fade and a keyframe, on a timeline at 30 frames a second. */
function clipAtThirty() {
  freshProject('Thirty')
  addAsset('footage', 120)
  const id = add('Overlay', 30, 60, { assetId: 'footage', inPoint: 300, name: 'shot' })
  run('clip.update', { ids: [id], patch: { audio: { fadeIn: 15, fadeOut: 9 } } })
  run('keyframe.set', { clipId: id, prop: 'opacity', frame: 0, value: 0 })
  run('keyframe.set', { clipId: id, prop: 'opacity', frame: 30, value: 1 })
  return id
}

const pasted = (at = 0): Clip => {
  const res = pasteClips(at)
  if (!res.ok) throw new Error(res.error)
  return getProject().clips[res.ids[0]]
}

const seconds = (c: Clip) => ({ length: c.duration / getProject().settings.fps, from: c.inPoint / getProject().settings.fps })

beforeEach(() => freshProject())

describe('a clip pasted on a timeline at another frame rate', () => {
  it('is as long, and from the same moment of its footage, on another timeline of the project', () => {
    const id = clipAtThirty()
    expect(seconds(clip(id))).toEqual({ length: 2, from: 10 })
    copyClips(getProject(), [id])
    run('sequence.create', { name: 'Sixty', settings: { fps: 60 } })
    expect(getProject().settings.fps).toBe(60)
    const there = pasted(0)
    // It was 60 frames from frame 300 there too: one second, from five seconds in.
    expect(seconds(there)).toEqual({ length: 2, from: 10 })
    expect(there.duration).toBe(120)
    expect(there.inPoint).toBe(600)
    // What is counted in frames inside it goes with it: its fades, its keyframes.
    expect([there.audio.fadeIn, there.audio.fadeOut]).toEqual([30, 18])
    expect(there.keyframes.opacity?.map((k) => k.frame)).toEqual([0, 60])
  })

  it('is, in another project', () => {
    const id = clipAtThirty()
    copyClips(getProject(), [id])
    freshProject('Twenty-five')
    run('project.update', { settings: { fps: 25 } })
    const there = pasted(0)
    expect(getProject().assets.footage?.name).toBe('footage')
    expect(seconds(there)).toEqual({ length: 2, from: 10 })
    expect(there.duration).toBe(50)
    expect(there.inPoint).toBe(250)
  })

  it('keeps several clips as far apart as they were', () => {
    freshProject('Sixty')
    run('project.update', { settings: { fps: 60 } })
    addAsset('footage', 120)
    const a = add('Overlay', 0, 120, { assetId: 'footage', name: 'a' })
    const b = add('Overlay', 240, 60, { assetId: 'footage', inPoint: 600, name: 'b' })
    copyClips(getProject(), [a, b])
    run('sequence.create', { name: 'Thirty', settings: { fps: 30 } })
    const res = pasteClips(10)
    if (!res.ok) throw new Error(res.error)
    const [first, second] = res.ids.map((id) => getProject().clips[id])
    // Two seconds, two seconds of nothing, one second: at 30 a second, from frame 10.
    expect([first.start, clipEnd(first), second.start, clipEnd(second)]).toEqual([10, 70, 130, 160])
    expect(second.inPoint).toBe(300)
  })

  it('is left as it is on a timeline at the same rate', () => {
    const id = clipAtThirty()
    copyClips(getProject(), [id])
    run('sequence.create', { name: 'Also thirty' })
    const there = pasted(0)
    expect([there.duration, there.inPoint, there.audio.fadeIn]).toEqual([60, 300, 15])
    expect(there.keyframes.opacity?.map((k) => k.frame)).toEqual([0, 30])
  })

  it('is pasted again and again without changing what was copied', () => {
    const id = clipAtThirty()
    copyClips(getProject(), [id])
    run('sequence.create', { name: 'Sixty', settings: { fps: 60 } })
    expect(pasted(0).duration).toBe(120)
    expect(pasted(600).duration).toBe(120)
    expect(pasted(1200).inPoint).toBe(600)
  })
})
