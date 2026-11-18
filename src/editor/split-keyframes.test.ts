import { beforeEach, describe, expect, it } from 'vitest'
import type { Easing } from './easing'
import { propAt } from './keyframes'
import { add, addAsset, clip, freshProject, run } from './test-helpers'
import { sourceFrameAt, speedAt } from './timing'

let id: string

beforeEach(() => {
  freshProject('Motion')
  addAsset('shot', 60)
  // A shot of a hundred frames over the main track, from frame 100, starting 200 frames into its footage.
  id = add('Overlay', 100, 100, { assetId: 'shot', inPoint: 200 })
})

const key = (frame: number, value: number, easing: Easing) => run('keyframe.set', { clipId: id, prop: 'scale', frame, value, easing })
/** How large the picture of a clip is at each frame of the timeline from `from` to `to`. */
const sizes = (of: string, from: number, to: number) => Array.from({ length: to - from }, (_, i) => Math.round(propAt(clip(of), 'scale', from + i - clip(of).start) * 1e4) / 1e4)

describe('a clip cut exactly on one of its keyframes', () => {
  it('goes on moving after the cut the way it did', () => {
    // Still for its first 30 frames, then a push in to its 90th that starts fast and settles.
    key(0, 1, 'linear')
    key(30, 1, 'expo-out')
    key(90, 1.6, 'linear')
    const before = sizes(id, 130, 200)
    // Fast at first: two thirds of the way in after a sixth of the time.
    expect(before[10]).toBeGreaterThan(1.4)
    // Cut where the push in begins. The piece after the cut starts on that keyframe — but was given the curve of
    // the one before it (the still part's): the push in went at an even pace instead.
    const [right] = run('clip.split', { frame: 130, ids: [id] }) as string[]
    expect(clip(id)).toMatchObject({ start: 100, duration: 30 })
    expect(clip(right)).toMatchObject({ start: 130, duration: 70 })
    expect(sizes(right, 130, 200)).toEqual(before)
    expect(sizes(id, 100, 130)).toEqual(Array.from({ length: 30 }, () => 1))
  })

  it('keeps the curve of the move it is cut through, when cut between two keyframes', () => {
    key(0, 1, 'expo-out')
    key(90, 1.6, 'linear')
    const [at, end] = [sizes(id, 130, 131)[0], sizes(id, 190, 191)[0]]
    const [right] = run('clip.split', { frame: 130, ids: [id] }) as string[]
    expect(clip(right).keyframes.scale).toMatchObject([{ frame: 0, value: expect.closeTo(at, 3), easing: 'expo-out' }, { frame: 60, value: 1.6 }])
    expect([sizes(right, 130, 131)[0], sizes(right, 190, 191)[0]]).toEqual([at, end])
  })
})

describe('a clip that changes speed, cut exactly where its speed begins to change', () => {
  /** Which frame of its footage a clip shows at each frame of the timeline from `from` to `to`, and how fast it is playing there. */
  const playing = (of: string, from: number, to: number) => Array.from({ length: to - from }, (_, i) => ({ footage: sourceFrameAt(clip(of), from + i - clip(of).start), speed: speedAt(clip(of), from + i - clip(of).start) }))

  it('goes on showing the footage it showed, at the speeds it had', () => {
    // At its own speed for its first half, then up to three times that — quickly at first.
    run('clip.setSpeedRamp', { id, points: [{ at: 0, speed: 1, easing: 'linear' }, { at: 0.5, speed: 1, easing: 'expo-out' }, { at: 1, speed: 3, easing: 'linear' }] })
    const turn = clip(id).keyframes.speed![1].frame
    const [cut, end] = [clip(id).start + turn, clip(id).start + clip(id).duration]
    const before = playing(id, cut, end)
    const [right] = run('clip.split', { frame: cut, ids: [id] }) as string[]
    expect(clip(right).start + clip(right).duration).toBe(end)
    const after = playing(right, cut, end)
    for (const [i, frame] of after.entries()) {
      expect(frame.speed, `speed at ${cut + i}`).toBeCloseTo(before[i].speed, 2)
      // The footage it starts on is a whole frame: within one of where it was.
      expect(Math.abs(frame.footage - before[i].footage), `footage at ${cut + i}`).toBeLessThan(1)
    }
  })
})
