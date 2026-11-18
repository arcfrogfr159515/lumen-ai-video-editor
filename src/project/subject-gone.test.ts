import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('sonner', () => ({ toast: Object.assign(() => {}, { error: () => {}, success: () => {} }) }))
// No model here. Finding the subject takes minutes in the app: here, until the test says it is done.
const model = vi.hoisted(() => ({ done: () => {} }))
vi.mock('./segment', () => ({ subjectMatte: () => new Promise((resolve) => (model.done = () => resolve({ assetId: 'matte', from: 0 }))) }))

const { addAsset, freshProject, run } = await import('@/editor/test-helpers')
const { getProject, useEditor } = await import('@/editor/store')
const { cutOutSubject, textBehindSubject } = await import('./subject')

let clipId = ''
beforeEach(() => {
  freshProject('Trip')
  addAsset('footage', 10)
  addAsset('matte', 10, 'video', { matteOf: { assetId: 'footage', subject: 'person', from: 0, to: 300 } })
  clipId = run('clip.add', { trackId: getProject().tracks.find((t) => t.name === 'Overlay')!.id, kind: 'video', start: 0, duration: 90, assetId: 'footage' }) as string
})

describe('a clip that is gone by the time its subject has been found', () => {
  it('is said to be gone when text was to go behind its subject', async () => {
    const asked = textBehindSubject(clipId, { text: 'HELLO' })
    // While the model works the clip is deleted.
    run('clip.delete', { ids: [clipId] })
    const before = getProject()
    const steps = useEditor.getState().past.length
    model.done()
    // It said "Cannot read properties of undefined (reading 'start')".
    await expect(asked).rejects.toThrow(`There’s no clip ${clipId}.`)
    expect(getProject().clips).toEqual(before.clips)
    expect(getProject().tracks.map((t) => t.name)).toEqual(before.tracks.map((t) => t.name))
    expect(useEditor.getState().past).toHaveLength(steps)
  })

  it('is said to be gone when another project was opened meanwhile', async () => {
    const asked = textBehindSubject(clipId, { text: 'HELLO' })
    freshProject('Another film')
    const before = getProject()
    model.done()
    await expect(asked).rejects.toThrow(`There’s no clip ${clipId}.`)
    expect(getProject().clips).toEqual(before.clips)
    expect(getProject().tracks).toEqual(before.tracks)
  })

  it('is said to be gone when it was to be cut out', async () => {
    const asked = cutOutSubject(clipId)
    run('clip.delete', { ids: [clipId] })
    model.done()
    await expect(asked).rejects.toThrow(/not found|no clip/i)
  })
})

describe('a clip that is still there when its subject has been found', () => {
  it('gets the text behind its subject, where it is by then', async () => {
    const asked = textBehindSubject(clipId, { text: 'HELLO' })
    // Moved along the timeline while the model works.
    run('clip.move', { moves: [{ id: clipId, start: 60, trackId: getProject().clips[clipId].trackId }] })
    model.done()
    const { subjectClipId, titleClipId } = await asked
    const p = getProject()
    expect(p.clips[clipId].start).toBe(60)
    expect(p.clips[titleClipId]).toMatchObject({ start: 60, duration: 90 })
    expect(p.clips[subjectClipId]).toMatchObject({ start: 60, duration: 90, matte: { assetId: 'matte', from: 0 } })
  })
})
