import { beforeEach, describe, expect, it } from 'vitest'
import { openSequenceId } from './sequences'
import { getProject, useEditor } from './store'
import { add, addAsset, clip, freshProject, run, trackId } from './test-helpers'

// A group left with a single clip isn't a group any more: the clip no longer says it is linked, to nothing. However
// the other clip went.

let picture: string
let sound: string

beforeEach(() => {
  freshProject('Groups')
  addAsset('footage', 60)
  addAsset('other', 60)
  addAsset('song', 60, 'audio')
  picture = add('Overlay', 100, 60, { assetId: 'footage', name: 'picture' })
  sound = add('Music', 100, 60, { assetId: 'song', name: 'sound' })
  run('clip.group', { ids: [picture, sound] })
  expect(clip(sound).groupId).toBe(clip(picture).groupId)
  expect(clip(sound).groupId).toBeTruthy()
})

describe('a clip whose only group mate is gone', () => {
  it('is not grouped after the mate is deleted (as it was)', () => {
    run('clip.delete', { ids: [picture], ripple: false })
    expect(clip(sound).groupId).toBeUndefined()
  })

  it('is not grouped after a clip is put over the mate', () => {
    // An overwrite edit covers the picture whole. Its sound went on showing the link, to a clip that wasn't there.
    run('clip.add', { trackId: trackId('Overlay'), kind: 'video', assetId: 'other', start: 90, duration: 90, mode: 'overwrite' })
    expect(getProject().clips[picture]).toBeUndefined()
    expect(clip(sound).groupId).toBeUndefined()
  })

  it('is not grouped after a clip is moved over the mate', () => {
    const mover = add('Overlay', 300, 90, { assetId: 'other', name: 'mover' })
    run('clip.move', { moves: [{ id: mover, start: 90 }], mode: 'overwrite' })
    expect(getProject().clips[picture]).toBeUndefined()
    expect(clip(sound).groupId).toBeUndefined()
  })

  it('is still grouped when a clip over the mate only trims it', () => {
    run('clip.add', { trackId: trackId('Overlay'), kind: 'video', assetId: 'other', start: 130, duration: 90, mode: 'overwrite' })
    expect(clip(picture).duration).toBe(30)
    expect(clip(sound).groupId).toBe(clip(picture).groupId)
  })

  it('is not grouped after the mate’s track is removed', () => {
    run('track.remove', { id: trackId('Overlay') })
    expect(getProject().clips[picture]).toBeUndefined()
    expect(clip(sound).groupId).toBeUndefined()
  })

  it('is not grouped after the mate’s media is removed — on the open timeline or another', () => {
    const film = openSequenceId(getProject())
    const copy = run('sequence.duplicate', { id: film, open: false }) as string
    run('asset.remove', { ids: ['footage'] })
    expect(clip(sound).groupId).toBeUndefined()
    const there = Object.values(getProject().sequences![copy].clips)
    expect(there.map((c) => c.name)).toEqual(['sound'])
    expect(there[0].groupId).toBeUndefined()
  })

  it('is grouped again when the removal is undone', () => {
    run('track.remove', { id: trackId('Overlay') })
    useEditor.getState().undo()
    expect(clip(sound).groupId).toBe(clip(picture).groupId)
    expect(clip(sound).groupId).toBeTruthy()
  })

  it('is not grouped when a nested clip is broken apart and only one of the two comes out', () => {
    // Nested together, then the nested clip cut down to show the picture's stretch only.
    freshProject('Nested')
    addAsset('footage', 60)
    addAsset('late', 60)
    const first = add('Overlay', 0, 60, { assetId: 'footage', name: 'first' })
    const second = add('Overlay', 100, 60, { assetId: 'late', name: 'second' })
    run('clip.group', { ids: [first, second] })
    const { clipId } = run('clip.nest', { ids: [first, second] }) as { clipId: string }
    run('clip.trim', { id: clipId, edge: 'end', frame: clip(clipId).start + 60 })
    const out = run('clip.unnest', { id: clipId }) as string[]
    expect(out.map((id) => clip(id).name)).toEqual(['first'])
    expect(clip(out[0]).groupId).toBeUndefined()
  })

  it('keeps both grouped when a nested clip is broken apart and both come out', () => {
    freshProject('Nested')
    addAsset('footage', 60)
    addAsset('late', 60)
    const first = add('Overlay', 0, 60, { assetId: 'footage', name: 'first' })
    const second = add('Overlay', 100, 60, { assetId: 'late', name: 'second' })
    run('clip.group', { ids: [first, second] })
    const { clipId } = run('clip.nest', { ids: [first, second] }) as { clipId: string }
    const out = run('clip.unnest', { id: clipId }) as string[]
    expect(out).toHaveLength(2)
    expect(clip(out[0]).groupId).toBeTruthy()
    expect(clip(out[0]).groupId).toBe(clip(out[1]).groupId)
  })
})
