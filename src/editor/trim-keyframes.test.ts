import { beforeEach, describe, expect, it } from 'vitest'
import { propAt } from './keyframes'
import { add, addAsset, clip, freshProject, run } from './test-helpers'

let id: string

beforeEach(() => {
  freshProject('Motion')
  addAsset('shot', 20)
  // A shot of a hundred frames over the main track, from frame 100, starting 200 frames into its footage.
  id = add('Overlay', 100, 100, { assetId: 'shot', inPoint: 200 })
})

/** How large the picture is at each frame of the timeline from `from` to `to`. */
const sizes = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => Math.round(propAt(clip(id), 'scale', from + i - clip(id).start) * 1e4) / 1e4)
const key = (frame: number, value: number) => run('keyframe.set', { clipId: id, prop: 'scale', frame, value, easing: 'linear' })

describe('a clip whose picture moves, trimmed at its head', () => {
  it('goes on moving as it did over the frames that are left', () => {
    // A push in from its 20th frame to its 60th.
    key(20, 1)
    key(60, 1.4)
    const before = sizes(121, 200)
    expect(before.slice(0, 3)).toEqual([1.01, 1.02, 1.03])
    // Its first 21 frames come off. The keyframe they held went with them and nothing was left where the push in
    // was cut: what remained was at 1.4 from its first frame.
    run('clip.trim', { id, edge: 'start', frame: 121 })
    expect(clip(id)).toMatchObject({ start: 121, duration: 79 })
    expect(sizes(121, 200)).toEqual(before)
  })

  it('stays where the move left it when all of the move is trimmed off', () => {
    key(5, 1)
    key(15, 1.4)
    const before = sizes(130, 200)
    expect(new Set(before)).toEqual(new Set([1.4]))
    // Every keyframe is in the 30 frames that come off: with none left, the picture went back to the size it has without any.
    run('clip.trim', { id, edge: 'start', frame: 130 })
    expect(sizes(130, 200)).toEqual(before)
  })

  it('goes on moving as it did when a keyframe lies past its end, too', () => {
    key(20, 1)
    key(80, 1.6)
    // The end comes in to the clip's 50th frame: the keyframe at 80 is past it, and the push in is cut short.
    run('clip.trim', { id, edge: 'end', frame: 150 })
    const before = sizes(110, 150)
    expect(before.at(-1)).toBe(1.29)
    run('clip.trim', { id, edge: 'start', frame: 110 })
    expect(sizes(110, 150)).toEqual(before)
  })

  it('moves as it did over what it had, when its head is drawn back out', () => {
    key(20, 1)
    key(60, 1.4)
    const before = sizes(100, 200)
    run('clip.trim', { id, edge: 'start', frame: 90 })
    expect(clip(id)).toMatchObject({ start: 90, duration: 110 })
    expect(sizes(100, 200)).toEqual(before)
  })
})
