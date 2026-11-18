import { beforeEach, describe, expect, it } from 'vitest'
import { PROP_RANGE } from './keyframes'
import { dispatch, getProject } from './store'
import { add, addAsset, clip, freshProject, run } from './test-helpers'

let id: string

beforeEach(() => {
  freshProject('Ranges')
  addAsset('shot', 20)
  id = add('Overlay', 0, 120, { assetId: 'shot' })
})

/** A copy of the clip as paste takes it, and whether paste takes it. */
const pastes = (clipId: string) => dispatch('clip.paste', { clips: [JSON.parse(JSON.stringify(clip(clipId)))], at: 600 })

describe('a keyframe', () => {
  it('holds a value its property can have: full opacity for “150”, as a clip’s own opacity would be refused', () => {
    // Opacity runs from 0 to 1, and a clip’s own is held to that. A keyframe took anything.
    expect(dispatch('clip.update', { ids: [id], patch: { transform: { opacity: 150 } } }).ok).toBe(false)
    run('keyframe.set', { clipId: id, prop: 'opacity', frame: 0, value: 150 })
    run('keyframe.set', { clipId: id, prop: 'opacity', frame: 30, value: -2 })
    run('keyframe.set', { clipId: id, prop: 'scale', frame: 0, value: -3 })
    run('keyframe.set', { clipId: id, prop: 'volume', frame: 0, value: 40 })
    run('keyframe.set', { clipId: id, prop: 'rotateY', frame: 0, value: 1000 })
    const values = (prop: 'opacity' | 'scale' | 'volume' | 'rotateY') => clip(id).keyframes[prop]!.map((k) => k.value)
    expect(values('opacity')).toEqual([1, 0])
    expect(values('scale')).toEqual([0])
    expect(values('volume')).toEqual([12])
    expect(values('rotateY')).toEqual([360])
    // Where a clip sits and how far it is turned have no bounds: nor have their keyframes.
    run('keyframe.set', { clipId: id, prop: 'x', frame: 0, value: -5000 })
    run('keyframe.set', { clipId: id, prop: 'rotation', frame: 0, value: 1080 })
    expect([clip(id).keyframes.x![0].value, clip(id).keyframes.rotation![0].value]).toEqual([-5000, 1080])
  })
})

describe('the bounds keyframes are held to', () => {
  it('are the bounds a clip’s own values are held to', () => {
    for (const [prop, [lo, hi]] of Object.entries(PROP_RANGE)) {
      const patch = (value: number) => (prop === 'volume' ? { audio: { volume: value } } : { transform: { [prop]: value } })
      const takes = (value: number) => dispatch('clip.update', { ids: [id], patch: patch(value) }).ok
      expect([takes(lo), takes(hi), takes(lo - 0.001), takes(hi + 0.001)], prop).toEqual([true, true, false, false])
    }
  })
})

describe('a clip whose keyframes hold more than its property can', () => {
  /** A clip that came with such keyframes: pasted as a tool might write one. */
  const wild = () => {
    const copy = JSON.parse(JSON.stringify(clip(id)))
    copy.keyframes = { opacity: [{ frame: 0, value: 5, easing: 'linear' }], scale: [{ frame: 0, value: 90, easing: 'linear' }, { frame: 60, value: -4, easing: 'linear' }] }
    const [pasted] = run('clip.paste', { clips: [copy], at: 300 }) as string[]
    return pasted
  }

  it('is left with values it can have when its animation is cleared — and can still be copied and pasted', () => {
    const c = wild()
    run('keyframe.clear', { clipId: c, prop: 'opacity' })
    // The first keyframe’s value became the clip’s own: an opacity of 5, which no clip may have. Paste refused it.
    expect(clip(c).transform.opacity).toBe(1)
    run('keyframe.remove', { clipId: c, prop: 'scale', frame: 0 })
    run('keyframe.remove', { clipId: c, prop: 'scale', frame: 60 })
    expect(clip(c).transform.scale).toBe(0)
    expect(clip(c).keyframes).toEqual({})
    expect(pastes(c)).toMatchObject({ ok: true })
  })

  it('gives a freeze frame values it can have', () => {
    const c = wild()
    const hold = run('clip.freeze', { id: c, frame: clip(c).start, duration: 30 }) as string
    expect(getProject().clips[hold].transform).toMatchObject({ opacity: 1, scale: 20 })
    expect(pastes(hold)).toMatchObject({ ok: true })
  })
})
