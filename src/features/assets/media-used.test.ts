import { beforeEach, describe, expect, it, vi } from 'vitest'

// Which media the Media panel calls used — and what it says when media is removed. A clip nested into a timeline
// of its own is still in the film: its media is used, and removing that media takes the clip with it.

const told: string[] = []
vi.mock('sonner', () => ({
  toast: Object.assign((message: string) => void told.push(message), { error: (message: string) => void told.push(message), success: () => {}, message: () => {}, loading: () => 1, dismiss: () => {} }),
}))
// The transport runs on animation frames and the audio engine, which only a browser has.
vi.mock('@/editor/playback', () => ({ playback: { pause: () => {}, seek: () => {} }, usePlayback: Object.assign(() => 0, { getState: () => ({ frame: 0, playing: false }), subscribe: () => () => {} }) }))

const { mediaCounts, usedMedia, visibleMedia } = await import('./library')
const { removeMedia } = await import('./media-selection')
const { add, addAsset, freshProject, run } = await import('@/editor/test-helpers')
const { getProject, useEditor } = await import('@/editor/store')

const view = { kind: 'all', shelf: 'unused', sort: 'name', query: '' } as const
const unused = () => visibleMedia(Object.values(getProject().assets), new Set(usedMedia(getProject())), view).map((a) => a.id)

beforeEach(() => {
  told.length = 0
  freshProject('Library')
  addAsset('interview', 60)
  addAsset('broll', 60)
  addAsset('spare', 60)
})

describe('the media a film uses', () => {
  it('is the media of its clips', () => {
    add('Main', 0, 60, { assetId: 'interview' })
    expect(usedMedia(getProject())).toEqual(['interview'])
    expect(unused()).toEqual(['broll', 'spare'])
  })

  it('still is when the clips are nested into a timeline of their own', () => {
    const a = add('Main', 0, 60, { assetId: 'interview' })
    const b = add('Main', 60, 60, { assetId: 'broll' })
    run('clip.nest', { ids: [a, b] })
    // One clip is left on the film's timeline, and it plays both: they were listed as unused, beside the one that is.
    expect(usedMedia(getProject()).sort()).toEqual(['broll', 'interview'])
    expect(unused()).toEqual(['spare'])
    expect(mediaCounts(Object.values(getProject().assets), new Set(usedMedia(getProject()))).unused).toBe(1)
  })

  it('still is two timelines down', () => {
    const a = add('Main', 0, 60, { assetId: 'interview' })
    const { clipId } = run('clip.nest', { ids: [a] }) as { clipId: string }
    run('clip.nest', { ids: [clipId] })
    expect(usedMedia(getProject())).toEqual(['interview'])
  })

  it('is not the media of a timeline the film doesn’t play', () => {
    add('Main', 0, 60, { assetId: 'interview' })
    // Another cut, made and left: what is on it isn't on this one.
    const other = run('sequence.create', { name: 'Shorts' }) as string
    add('Main', 0, 60, { assetId: 'broll' })
    expect(usedMedia(getProject())).toEqual(['broll'])
    run('sequence.open', { id: Object.keys(getProject().sequences!).find((id) => id !== other)! })
    expect(usedMedia(getProject())).toEqual(['interview'])
  })
})

describe('removing media', () => {
  it('says how many clips went with it on the open timeline', () => {
    add('Main', 0, 60, { assetId: 'interview' })
    add('Main', 60, 60, { assetId: 'interview' })
    removeMedia(['interview'])
    expect(told).toEqual(['Removed 1 media item and 2 clips using it'])
  })

  it('says so for clips inside a nested timeline', () => {
    const a = add('Main', 0, 60, { assetId: 'interview' })
    const b = add('Main', 60, 60, { assetId: 'broll' })
    const { sequenceId } = run('clip.nest', { ids: [a, b] }) as { sequenceId: string }
    removeMedia(['interview'])
    // The clip inside the nested timeline was removed with it, and nothing said so: “Removed 1 media item”.
    expect(Object.values(getProject().sequences![sequenceId].clips).map((c) => c.assetId)).toEqual(['broll'])
    expect(told).toEqual(['Removed 1 media item and 1 clip using it'])
  })

  it('says so for clips on a timeline that isn’t open', () => {
    add('Main', 0, 60, { assetId: 'interview' })
    run('sequence.create', { name: 'Shorts' })
    add('Main', 0, 60, { assetId: 'broll' })
    removeMedia(['interview', 'broll'])
    expect(told).toEqual(['Removed 2 media items and 2 clips using them'])
    useEditor.getState().undo()
    expect(Object.keys(getProject().assets).sort()).toEqual(['broll', 'interview', 'spare'])
  })

  it('says nothing of clips when none used it', () => {
    removeMedia(['spare'])
    expect(told).toEqual(['Removed 1 media item'])
  })
})
