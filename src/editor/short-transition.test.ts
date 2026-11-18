import { beforeEach, describe, expect, it } from 'vitest'
import { dispatch } from './store'
import { add, addAsset, clip, freshProject, run } from './test-helpers'

let last: string

beforeEach(() => {
  freshProject('Cuts')
  addAsset('shot', 20)
  add('Overlay', 0, 30, { assetId: 'shot' })
  // A clip of a single frame after it: a leftover of a split.
  last = add('Overlay', 30, 1, { assetId: 'shot', inPoint: 100 })
})

describe('a transition onto a clip of one frame', () => {
  it('is two frames long, the shortest a transition can be — and the clip can still be copied and pasted', () => {
    // A transition can't be asked for shorter than two frames, and no clip with a shorter one is taken by paste.
    expect(dispatch('clip.setTransition', { id: last, transition: { kind: 'dissolve', duration: 1 } }).ok).toBe(false)
    // Cut down to the clip's length it came out one frame long: a clip that, copied, could not be pasted.
    run('clip.setTransition', { id: last, transition: { kind: 'dissolve', duration: 20 } })
    expect(clip(last).transitionIn).toMatchObject({ kind: 'dissolve', duration: 2 })
    const res = dispatch('clip.paste', { clips: [JSON.parse(JSON.stringify(clip(last)))], at: 200 })
    expect(res).toMatchObject({ ok: true })
  })

  it('is still cut down to the clips it runs over when they are longer than that', () => {
    const next = add('Overlay', 31, 10, { assetId: 'shot', inPoint: 200 })
    run('clip.setTransition', { id: next, transition: { kind: 'dissolve', duration: 60 } })
    expect(clip(next).transitionIn!.duration).toBe(10)
  })
})
