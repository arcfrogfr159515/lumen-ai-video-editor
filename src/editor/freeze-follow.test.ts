import { beforeEach, describe, expect, it } from 'vitest'
import { propAt } from './keyframes'
import { followOffset } from './motion'
import { getProject } from './store'
import { add, addAsset, clip, freshProject, run } from './test-helpers'
import type { Clip } from './types'

let id: string

/** A point that moves by (10, 5) a frame for sixty frames: where it is at each of them. */
const moving = (step: [number, number]) => Array.from({ length: 61 }, (_, i) => [i * step[0], i * step[1]]).flat()

beforeEach(() => {
  freshProject('Tracked')
  addAsset('shot', 20)
  // A title-like overlay of a hundred frames from frame 100, that follows the point from its tenth frame on.
  id = add('Overlay', 100, 100, { assetId: 'shot' })
  run('clip.update', { ids: [id], patch: { follow: { start: 10, ref: 0, points: moving([10, 5]) } } })
})

/** Where a clip is at a frame of its own: where it was put, and how far the point it follows has carried it. */
function placeOf(c: Clip, local: number) {
  const [ox, oy] = c.follow ? followOffset(c.follow, local) : [0, 0]
  return [propAt(c, 'x', local) + ox, propAt(c, 'y', local) + oy]
}

/** Where a clip's first mask is at a frame of the clip's own. */
function maskAt(c: Clip, local: number) {
  const mask = c.masks![0]
  const [ox, oy] = mask.follow ? followOffset(mask.follow, local) : [0, 0]
  return [Math.round((mask.x + ox) * 1e4) / 1e4, Math.round((mask.y + oy) * 1e4) / 1e4]
}

const held = () => Object.values(getProject().clips).find((c) => c.freeze)!

describe('a freeze frame of a clip that follows something', () => {
  it('stays where the clip was at that frame', () => {
    // At its fortieth frame the point has moved for thirty: the clip is 300 to the right and 150 down.
    expect(placeOf(clip(id), 40)).toEqual([300, 150])
    run('clip.freeze', { id, frame: 140, duration: 30 })
    const hold = held()
    expect(hold).toMatchObject({ start: 140, duration: 30 })
    // The hold was given the path as it is, to follow from its own first frame: for its first ten frames it stood
    // where the clip began, and then moved off the way the clip had — a freeze frame that isn't still, and isn't
    // where the picture was.
    expect(Array.from({ length: 30 }, (_, local) => placeOf(hold, local))).toEqual(Array.from({ length: 30 }, () => [300, 150]))
  })

  it('keeps a mask that follows something where it was at that frame, too', () => {
    run('mask.add', { clipId: id, mask: { shape: 'ellipse', x: 0.5, y: 0.5, follow: { start: 0, ref: 0, points: moving([0.002, 0.001]) } } })
    expect(maskAt(clip(id), 40)).toEqual([0.58, 0.54])
    run('clip.freeze', { id, frame: 140, duration: 30 })
    expect(Array.from({ length: 30 }, (_, local) => maskAt(held(), local))).toEqual(Array.from({ length: 30 }, () => [0.58, 0.54]))
  })

  it('leaves the clip itself following as it did, either side of the hold', () => {
    const before = Array.from({ length: 100 }, (_, local) => placeOf(clip(id), local))
    run('clip.freeze', { id, frame: 140, duration: 30 })
    const pieces = Object.values(getProject().clips)
      .filter((c) => !c.freeze && c.kind === 'video')
      .sort((a, b) => a.start - b.start)
    expect(pieces.map((c) => [c.start, c.duration])).toEqual([
      [100, 40],
      [170, 60],
    ])
    expect(Array.from({ length: 40 }, (_, local) => placeOf(pieces[0], local))).toEqual(before.slice(0, 40))
    expect(Array.from({ length: 60 }, (_, local) => placeOf(pieces[1], local))).toEqual(before.slice(40))
  })
})
