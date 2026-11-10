import { beforeEach, describe, expect, it } from 'vitest'
import { findReuse, reuseByClip, reusedFrames } from './reuse'
import { getProject } from './store'
import { add, addAsset, freshProject, run } from './test-helpers'

beforeEach(() => {
  freshProject('Reuse')
  addAsset('long', 60)
  addAsset('other', 60)
})

const reuse = (min?: number) => findReuse(getProject(), min)

describe('footage used more than once', () => {
  it('finds the stretch two clips share, and where it is in each', () => {
    const a = add('Main', 0, 100, { assetId: 'long', inPoint: 200 })
    const b = add('Main', 100, 80, { assetId: 'long', inPoint: 260 })
    add('Main', 180, 50, { assetId: 'other', inPoint: 200 })
    const spans = reuse()
    expect(spans).toHaveLength(1)
    expect(spans[0]).toMatchObject({ assetId: 'long', stream: 'picture', from: 260, to: 300 })
    expect(spans[0].uses).toEqual([
      { clipId: a, start: 60, end: 100 },
      { clipId: b, start: 0, end: 40 },
    ])
    expect(reusedFrames(spans)).toBe(40)
  })

  it('follows speed and reverse back to the same source frames', () => {
    const fast = add('Main', 0, 50, { assetId: 'long', inPoint: 100 })
    run('clip.update', { ids: [fast], patch: { speed: 2 } })
    const back = add('Overlay', 300, 60, { assetId: 'long', inPoint: 140 })
    run('clip.update', { ids: [back], patch: { reverse: true } })
    // fast plays source 100–150 in 25 frames; back plays 140–200 backwards.
    const [span] = reuse()
    expect([span.from, span.to]).toEqual([140, 150])
    expect(span.uses.find((u) => u.clipId === fast)).toMatchObject({ start: 20, end: 25 })
    expect(span.uses.find((u) => u.clipId === back)).toMatchObject({ start: 50, end: 60 })
  })

  it('does not count a video and its own detached sound as two uses', () => {
    const v = add('Main', 0, 100, { assetId: 'long' })
    run('clip.detachAudio', { ids: [v] })
    expect(reuse()).toEqual([])
  })

  it('counts sound separately from picture', () => {
    add('Voice', 0, 100, { assetId: 'long', kind: 'audio' })
    add('Voice', 200, 100, { assetId: 'long', inPoint: 50, kind: 'audio' })
    const [span] = reuse()
    expect(span).toMatchObject({ stream: 'sound', from: 50, to: 100 })
  })

  it('splits where a third clip joins in, and ignores stills, freezes and slivers', () => {
    const a = add('Main', 0, 100, { assetId: 'long' })
    const b = add('Main', 100, 100, { assetId: 'long', inPoint: 50 })
    const c = add('Main', 200, 100, { assetId: 'long', inPoint: 80 })
    const spans = reuse()
    expect(spans.map((s) => [s.from, s.to, s.uses.length])).toEqual([
      [50, 80, 2],
      [80, 100, 3],
      [100, 150, 2],
    ])
    const byClip = reuseByClip(spans)
    expect(byClip.get(a)).toEqual([[50, 100]])
    expect(byClip.get(b)).toEqual([[0, 100]])
    expect(byClip.get(c)).toEqual([[0, 70]])
    run('clip.freeze', { id: c, frame: 250, duration: 30 })
    // The freeze holds one frame: it is not footage playing again.
    expect(reuse().every((s) => s.uses.every((u) => !getProject().clips[u.clipId].freeze))).toBe(true)
    // A single frame in common is not worth a flag.
    freshProject('Reuse')
    addAsset('long', 60)
    add('Main', 0, 100, { assetId: 'long' })
    add('Main', 100, 100, { assetId: 'long', inPoint: 99 })
    expect(reuse()).toEqual([])
    expect(reuse(1)).toHaveLength(1)
  })
})
