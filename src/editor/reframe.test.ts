import { beforeEach, describe, expect, it } from 'vitest'
import { reframe } from './smart'
import { getProject, useEditor } from './store'
import { add, addAsset, freshProject, run, trackId } from './test-helpers'

let footage = ''
let title = ''
const steps = () => useEditor.getState().past.length

beforeEach(() => {
  freshProject('Canvas')
  // Footage that fills the 1920×1080 canvas, and a title off to one side.
  addAsset('wide', 10, 'video', { width: 1920, height: 1080 })
  footage = add('Main', 0, 90, { assetId: 'wide' })
  title = run('clip.add', { trackId: trackId('Titles'), kind: 'text', start: 0, duration: 60, patch: { text: { content: 'Hello', size: 100 }, transform: { x: 200, y: -300 } } }) as string
})

describe('changing the canvas', () => {
  it('fills the new frame with the footage that filled the old one, and moves the titles with it — in one step', () => {
    const before = getProject()
    const was = steps()
    expect(reframe(1080, 1920)).toEqual({ changed: true })
    const p = getProject()
    expect(p.settings).toMatchObject({ width: 1080, height: 1920 })
    expect(p.clips[footage].transform.scale).toBeCloseTo(3.16, 2)
    expect(p.clips[title].transform).toMatchObject({ x: 113, y: -533 })
    expect(p.clips[title].text?.size).toBe(56)
    expect(steps()).toBe(was + 1)
    useEditor.getState().undo()
    expect(getProject()).toEqual(before)
    expect(reframe(1920, 1080)).toEqual({ changed: false })
  })

  it('changes nothing when the canvas can’t be that size', () => {
    // The size was refused — and the titles and the footage were moved and resized for it all the same, on a canvas
    // that hadn't changed. The answer was "changed", as if it had.
    const before = getProject()
    const was = steps()
    for (const [width, height] of [
      [10000, 10000],
      [8, 8],
      [1080, 100000],
      [NaN, 1080],
    ]) {
      let answer: unknown
      try {
        answer = reframe(width, height)
      } catch (err) {
        answer = err
      }
      expect(getProject().clips[title], `${width}×${height}`).toEqual(before.clips[title])
      expect(getProject(), `${width}×${height}`).toEqual(before)
      expect(steps(), `${width}×${height}`).toBe(was)
      expect(answer, `${width}×${height}`).toBeInstanceOf(Error)
    }
  })
})
