import { beforeEach, describe, expect, it } from 'vitest'
import { copyClips, pasteClips, useClipboard } from './clipboard'
import { createEmptyProject } from './new-project'
import { getProject, useEditor } from './store'
import { add, addAsset, asset, clip, freshProject, refusal, run } from './test-helpers'
import { problems } from './test-invariants'

beforeEach(() => {
  useClipboard.setState({ data: null, attributes: null })
  freshProject('Here')
  addAsset('shot', 20)
  // The subject of the shot, as a matte: a media item of its own, made from the shot.
  run('asset.add', { asset: asset('shot-matte', 20, 'video', { matteOf: { assetId: 'shot', subject: 'person', from: 0, to: 20 } }) })
})

/** Copies a clip here and pastes it into a project that has none of this one's media. Returns the pasted clip's id. */
function pasteElsewhere(id: string) {
  expect(copyClips(getProject(), [id])).toBe(1)
  useEditor.getState().loadProject(createEmptyProject('Other'))
  const res = pasteClips(0)
  expect(res).toMatchObject({ ok: true })
  return (res as { ids: string[] }).ids[0]
}

describe('a clip pasted into another project', () => {
  it('brings the matte it is cut out with', () => {
    const id = add('Overlay', 0, 60, { assetId: 'shot' })
    run('clip.update', { ids: [id], patch: { matte: { assetId: 'shot-matte', from: 0 } } })
    const pasted = pasteElsewhere(id)
    expect(clip(pasted).matte).toEqual({ assetId: 'shot-matte', from: 0 })
    // Only the picture's media came along. A cut-out whose matte isn't there draws nothing at all: it waits for
    // a matte that is never going to load.
    expect(Object.keys(getProject().assets).sort()).toEqual(['shot', 'shot-matte'])
  })

  it('brings the media of its other takes', () => {
    addAsset('alt', 20)
    const id = add('Overlay', 0, 60, { assetId: 'shot' })
    run('take.add', { clipId: id, assetId: 'alt' })
    expect(clip(id)).toMatchObject({ assetId: 'alt' })
    const pasted = pasteElsewhere(id)
    expect(clip(pasted).takes).toHaveLength(2)
    // The take that was showing came with its media; the other was listed as “Missing media” and couldn't be shown.
    expect(Object.keys(getProject().assets).sort()).toEqual(['alt', 'shot'])
    expect(problems(getProject())).toEqual([])
    run('take.switch', { clipId: pasted, step: 1 })
    expect(clip(pasted)).toMatchObject({ assetId: 'shot' })
  })

  it('brings the matte a take that is put away was cut out with', () => {
    addAsset('alt', 20)
    const id = add('Overlay', 0, 60, { assetId: 'shot' })
    run('clip.update', { ids: [id], patch: { matte: { assetId: 'shot-matte', from: 0 } } })
    // Another take is shown: the cut-out is put away with the footage it was made for.
    run('take.add', { clipId: id, assetId: 'alt' })
    expect(clip(id).matte).toBeUndefined()
    const pasted = pasteElsewhere(id)
    expect(Object.keys(getProject().assets).sort()).toEqual(['alt', 'shot', 'shot-matte'])
    run('take.switch', { clipId: pasted, step: 1 })
    expect(clip(pasted)).toMatchObject({ assetId: 'shot', matte: { assetId: 'shot-matte', from: 0 } })
  })
})

describe('a cut-out pasted where its matte isn’t', () => {
  /** A copy of a clip as paste is given it, cut out with `assetId`. */
  const cutOutWith = (id: string, assetId: string) => [{ ...structuredClone(clip(id)), matte: { assetId, from: 0 } }] as never

  it('is refused, as that matte is when it is set on a clip', () => {
    const id = add('Overlay', 0, 60, { assetId: 'shot' })
    // Media that isn't in the project, and media that is no matte: neither can be set on a clip as its matte —
    // but a clip that came with one was pasted, to draw nothing (the compositor shows none of a cut-out until its
    // matte has loaded).
    for (const assetId of ['gone', 'shot']) {
      expect(refusal('clip.update', { ids: [id], patch: { matte: { assetId, from: 0 } } })).toMatch(/matte/)
      expect(refusal('clip.paste', { clips: cutOutWith(id, assetId), at: 100 })).toMatch(/matte/)
    }
    expect(Object.keys(getProject().clips)).toEqual([id])
  })

  it('is refused when it is a take put away that was cut out with it', () => {
    addAsset('alt', 20)
    const id = add('Overlay', 0, 60, { assetId: 'shot' })
    run('clip.update', { ids: [id], patch: { matte: { assetId: 'shot-matte', from: 0 } } })
    run('take.add', { clipId: id, assetId: 'alt' })
    const copy = structuredClone(clip(id))
    copy.takes!.find((t) => t.matte)!.matte = { assetId: 'gone', from: 0 }
    expect(refusal('clip.paste', { clips: [copy] as never, at: 100 })).toMatch(/matte/)
    expect(Object.keys(getProject().clips)).toEqual([id])
  })

  it('is pasted as it is where its matte is', () => {
    const id = add('Overlay', 0, 60, { assetId: 'shot' })
    const [pasted] = run('clip.paste', { clips: cutOutWith(id, 'shot-matte'), at: 100 }) as string[]
    expect(clip(pasted).matte).toEqual({ assetId: 'shot-matte', from: 0 })
  })
})
