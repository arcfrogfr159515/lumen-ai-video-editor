import { describe, expect, it } from 'vitest'
import type { CommandInput, CommandName } from './commands'
import { dispatch, getProject } from './store'
import { add, addAsset, clip, freshProject, refusal, run, trackId } from './test-helpers'

/** A clip with an effect, a mask and a move, on a track that is then locked. */
function lockedClip() {
  freshProject('Locked')
  addAsset('shot', 20)
  const id = add('Overlay', 0, 60, { assetId: 'shot' })
  run('effect.add', { ids: [id], kind: 'blur' })
  const maskId = run('mask.add', { clipId: id, mask: {} }) as string
  run('keyframe.set', { clipId: id, prop: 'scale', frame: 0, value: 1 })
  run('keyframe.set', { clipId: id, prop: 'scale', frame: 30, value: 1.5 })
  const effectId = clip(id).effects[0].id
  run('track.update', { id: trackId('Overlay'), patch: { locked: true } })
  return { id, maskId, effectId }
}

type Edit = <N extends CommandName>(name: N, input: (made: ReturnType<typeof lockedClip>) => CommandInput<N>) => [CommandName, (made: ReturnType<typeof lockedClip>) => unknown]
const edit: Edit = (name, input) => [name, input]

describe('a clip on a locked track', () => {
  it('keeps its effects, its masks and its keyframes: taking them off is refused, as putting them on is', () => {
    const edits = [
      // Putting them on, and changing a mask or a keyframe, was refused already.
      edit('effect.add', ({ id }) => ({ ids: [id], kind: 'sharpen' })),
      edit('mask.add', ({ id }) => ({ clipId: id, mask: {} })),
      edit('mask.update', ({ id, maskId }) => ({ clipId: id, maskId, patch: { invert: true } })),
      edit('keyframe.set', ({ id }) => ({ clipId: id, prop: 'scale', frame: 10, value: 2 })),
      edit('keyframe.move', ({ id }) => ({ clipId: id, from: 30, to: 40 })),
      // Changing an effect and taking any of them off went through.
      edit('effect.update', ({ id, effectId }) => ({ clipId: id, effectId, patch: { enabled: false } })),
      edit('effect.remove', ({ id, effectId }) => ({ clipId: id, effectId })),
      edit('mask.remove', ({ id, maskId }) => ({ clipId: id, maskId })),
      edit('keyframe.remove', ({ id }) => ({ clipId: id, prop: 'scale', frame: 30 })),
      edit('keyframe.clear', ({ id }) => ({ clipId: id, prop: 'scale' })),
    ]
    const went: string[] = []
    for (const [name, input] of edits) {
      const made = lockedClip()
      const before = getProject()
      const res = dispatch(name, input(made) as never)
      if (res.ok) went.push(name)
      else {
        expect(res.error, name).toMatch(/is on a locked track/)
        expect(getProject(), name).toBe(before)
      }
    }
    expect(went).toEqual([])
  })

  it('can have them changed again once its track is unlocked', () => {
    const { id, maskId, effectId } = lockedClip()
    run('track.update', { id: trackId('Overlay'), patch: { locked: false } })
    run('effect.update', { clipId: id, effectId, patch: { enabled: false } })
    run('effect.remove', { clipId: id, effectId })
    run('mask.remove', { clipId: id, maskId })
    run('keyframe.remove', { clipId: id, prop: 'scale', frame: 30 })
    run('keyframe.clear', { clipId: id, prop: 'scale' })
    expect(clip(id)).toMatchObject({ effects: [], keyframes: {} })
    expect(clip(id).masks).toBeUndefined()
  })
})

describe('detached sound on a locked track', () => {
  it('stays there: putting it back into its picture is refused, as deleting it is', () => {
    freshProject('Locked')
    addAsset('shot', 20)
    const id = add('Overlay', 0, 60, { assetId: 'shot' })
    const [sound] = run('clip.detachAudio', { ids: [id] }) as string[]
    const track = clip(sound).trackId
    run('track.update', { id: track, patch: { locked: true } })
    const before = getProject()
    expect(refusal('clip.delete', { ids: [sound] })).toMatch(/is on a locked track/)
    // The picture's own track isn't locked, and that was all that was asked: the sound clip was taken off the
    // locked track.
    expect(refusal('clip.reattachAudio', { ids: [id] })).toMatch(/is on a locked track/)
    expect(getProject()).toBe(before)
    // Unlocked, the sound goes back into the picture.
    run('track.update', { id: track, patch: { locked: false } })
    run('clip.reattachAudio', { ids: [id] })
    expect(clip(sound)).toBeUndefined()
    expect(clip(id).audio.detached).toBeUndefined()
  })
})
