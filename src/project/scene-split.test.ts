import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('sonner', () => ({ toast: Object.assign(() => {}, { error: () => {}, success: () => {}, loading: () => 1, dismiss: () => {} }) }))
// No footage is read here: the shots change one and two seconds into the file.
const detectScenes = vi.fn(async () => ({ cuts: [1, 2], frames: 90 }))
vi.mock('@/engine/scenes', () => ({ detectScenes }))

const { scenesInClip } = await import('./analysis-actions')
const { getProject, useEditor } = await import('@/editor/store')
const { add, addAsset, freshProject, run, spans, trackId } = await import('@/editor/test-helpers')

let id: string

beforeEach(() => {
  detectScenes.mockClear()
  freshProject('Scenes')
  addAsset('footage', 10)
  id = add('Overlay', 0, 90, { assetId: 'footage' })
})

describe('a clip split at its scene cuts', () => {
  it('is cut where its shots change, as one step', async () => {
    const res = await scenesInClip(id, { action: 'split' })
    expect(res).toMatchObject({ cuts: [30, 60], applied: 'split' })
    expect(res.clipIds).toHaveLength(3)
    expect(spans('Overlay')).toEqual([[0, 30], [30, 60], [60, 90]])
    useEditor.getState().undo()
    expect(spans('Overlay')).toEqual([[0, 90]])
  })

  it('isn’t said to have been split when it is on a locked track — and its footage isn’t read to find that out', async () => {
    run('track.update', { id: trackId('Overlay'), patch: { locked: true } })
    const steps = useEditor.getState().past.length
    // Each cut was refused, and the answer was “split”: “Split at 2 scene cuts” in the app, with the clip whole.
    await expect(scenesInClip(id, { action: 'split' })).rejects.toThrow(/is on a locked track/)
    expect(detectScenes).not.toHaveBeenCalled()
    expect(spans('Overlay')).toEqual([[0, 90]])
    expect(useEditor.getState().past).toHaveLength(steps)
  })

  it('can still have its scene cuts found and marked on a locked track: that cuts nothing', async () => {
    run('track.update', { id: trackId('Overlay'), patch: { locked: true } })
    expect(await scenesInClip(id, { action: 'none' })).toMatchObject({ cuts: [30, 60], applied: 'none' })
    expect(await scenesInClip(id, { action: 'markers' })).toMatchObject({ cuts: [30, 60], applied: 'markers' })
    expect(getProject().markers.map((m) => m.frame)).toEqual([30, 60])
    expect(spans('Overlay')).toEqual([[0, 90]])
  })
})
