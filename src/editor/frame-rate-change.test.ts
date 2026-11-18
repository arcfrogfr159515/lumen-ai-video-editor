import { beforeEach, describe, expect, it } from 'vitest'
import { getProject } from './store'
import { add, addAsset, freshProject, run, spans } from './test-helpers'
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
