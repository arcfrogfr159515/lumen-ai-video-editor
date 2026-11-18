import { beforeEach, describe, expect, it } from 'vitest'
import { getProject } from './store'
import { addAsset, clip, freshProject, run, trackId } from './test-helpers'
import { problems } from './test-invariants'

beforeEach(() => {
  freshProject('In points')
  // Ten seconds of footage: 300 frames.
  addAsset('shot', 10)
})

describe('a clip added from further into its media than the media runs', () => {
  it('starts on the media’s last frame at the latest, as a take added that way does', () => {
    // Asked to start 500 frames in, it was made one frame long — of footage 200 frames past the end of the file.
    const id = run('clip.add', { trackId: trackId('Overlay'), kind: 'video', assetId: 'shot', start: 0, duration: 60, inPoint: 500 }) as string
    expect(clip(id)).toMatchObject({ inPoint: 299, duration: 1 })
    expect(problems(getProject())).toEqual([])
    // A take is brought back inside its media the same way.
    const other = run('clip.add', { trackId: trackId('Overlay'), kind: 'video', assetId: 'shot', start: 100, duration: 60 }) as string
    run('take.add', { clipId: other, assetId: 'shot', inPoint: 500, show: false })
    expect(clip(other).takes!.at(-1)!.inPoint).toBe(299)
  })

  it('is as long as asked when its media has that much left, and no longer than what is left', () => {
    const whole = run('clip.add', { trackId: trackId('Overlay'), kind: 'video', assetId: 'shot', start: 0, duration: 60, inPoint: 200 }) as string
    expect(clip(whole)).toMatchObject({ inPoint: 200, duration: 60 })
    const cut = run('clip.add', { trackId: trackId('Overlay'), kind: 'video', assetId: 'shot', start: 100, duration: 60, inPoint: 280 }) as string
    expect(clip(cut)).toMatchObject({ inPoint: 280, duration: 20 })
  })

  it('holds for a clip that plays another timeline, too', () => {
    const inner = run('sequence.create', { name: 'Inner', open: true }) as string
    run('clip.add', { trackId: trackId('Overlay'), kind: 'video', assetId: 'shot', start: 0, duration: 90 })
    const outer = run('sequence.create', { name: 'Outer', open: true }) as string
    expect(outer).not.toBe(inner)
    const id = run('clip.add', { trackId: trackId('Overlay'), kind: 'video', sequenceId: inner, start: 0, duration: 60, inPoint: 400 }) as string
    expect(clip(id)).toMatchObject({ inPoint: 89, duration: 1 })
  })
})
