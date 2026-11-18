import { beforeEach, describe, expect, it } from 'vitest'
import { followOffset } from './motion'
import { getProject } from './store'
import { add, addAsset, clip, freshProject, run, spans } from './test-helpers'
import { problems } from './test-invariants'

beforeEach(() => {
  freshProject('Rates')
  // A timeline at 60 frames a second, to be made 30: every odd frame falls between two of the new ones.
  run('project.update', { settings: { fps: 60 } })
  addAsset('pictures', 60)
  addAsset('song', 60, 'audio')
})

describe('a timeline given another frame rate', () => {
  it('keeps clips that touch touching: none ends a frame into the next', () => {
    add('Overlay', 3, 3, { assetId: 'pictures' })
    add('Overlay', 6, 3, { assetId: 'pictures' })
    add('Overlay', 9, 5, { assetId: 'pictures' })
    expect(spans('Overlay')).toEqual([[3, 6], [6, 9], [9, 14]])
    run('project.update', { settings: { fps: 30 } })
    // A clip's start and its length were each rounded to the new frames: both up, here, and the first clip ended
    // on frame 4 with the second starting on 3.
    expect(problems(getProject())).toEqual([])
    expect(spans('Overlay')).toEqual([[2, 3], [3, 5], [5, 7]])
  })

  it('keeps the main track in step with what runs beside it', () => {
    // Ten shots of three frames on the main track, and a song under all thirty.
    for (let i = 0; i < 10; i++) add('Main', i * 3, 3, { assetId: 'pictures', inPoint: i * 60 })
    add('Music', 0, 30, { assetId: 'song' })
    run('project.update', { settings: { fps: 30 } })
    expect(spans('Music')).toEqual([[0, 15]])
    // Each shot's length was rounded up to two frames: twenty in all, a third longer than the song they ran with.
    expect(spans('Main').at(-1)![1]).toBe(15)
    expect(problems(getProject())).toEqual([])
  })

  it('leaves whole frames whole: twice the rate is twice the frames', () => {
    add('Overlay', 3, 3, { assetId: 'pictures' })
    add('Overlay', 6, 5, { assetId: 'pictures' })
    run('project.update', { settings: { fps: 120 } })
    expect(spans('Overlay')).toEqual([[6, 12], [12, 22]])
  })
})

describe('what follows a tracked point, on a timeline given another frame rate', () => {
  /** A point that moves ten pixels to the right every sixtieth of a second, tracked for a second from `start`. */
  const path = (start: number) => ({ start, ref: 0, points: Array.from({ length: 61 }, (_, i) => [i * 10, 0]).flat() })
  /** How far the point has carried what follows it, at moments of the clip given in seconds. */
  const carried = (follow: () => { start: number; ref: number; points: number[] }, seconds: number[]) => seconds.map((s) => Math.round(followOffset(follow(), s * getProject().settings.fps)[0]))

  it('is where it was at each moment: a clip’s path is kept in time, not in frames', () => {
    const id = add('Overlay', 0, 120, { assetId: 'pictures' })
    run('clip.update', { ids: [id], patch: { follow: path(30) } })
    const moments = [0, 0.5, 0.75, 1, 1.5, 2]
    const before = carried(() => clip(id).follow!, moments)
    expect(before).toEqual([0, 0, 150, 300, 600, 600])
    // The path has a point for every frame. At half the frames a second it went on being read a point a frame:
    // the clip moved at half the pace of what it follows, and started half a second late.
    run('project.update', { settings: { fps: 30 } })
    expect(carried(() => clip(id).follow!, moments)).toEqual(before)
    // And back up again, at twice the rate.
    run('project.update', { settings: { fps: 120 } })
    expect(carried(() => clip(id).follow!, moments)).toEqual(before)
  })

  it('is where it was at each moment: a mask’s path, the same', () => {
    const id = add('Overlay', 0, 120, { assetId: 'pictures' })
    const maskId = run('mask.add', { clipId: id, mask: {} }) as string
    run('mask.update', { clipId: id, maskId, patch: { follow: path(0) } })
    const moments = [0, 0.25, 0.5, 1]
    const before = carried(() => clip(id).masks![0].follow!, moments)
    expect(before).toEqual([0, 150, 300, 600])
    run('project.update', { settings: { fps: 30 } })
    expect(carried(() => clip(id).masks![0].follow!, moments)).toEqual(before)
  })
})
