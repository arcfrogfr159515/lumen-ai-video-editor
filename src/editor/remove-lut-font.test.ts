import { beforeEach, describe, expect, it } from 'vitest'
import { openSequenceId } from './sequences'
import { getProject, useEditor } from './store'
import { add, addAsset, clip, freshProject, run } from './test-helpers'
import type { Clip } from './types'

// A LUT and a font belong to the project, not to one timeline: taken out of the project, every clip that used
// them — on the open timeline, on the others, in a nested one — is left without them.

let lut: string
let font: string
let graded: string
let title: string

beforeEach(() => {
  freshProject('Looks')
  addAsset('a', 60)
  lut = run('lut.add', { lut: { name: 'Teal and orange', size: 2, data: btoa('\0'.repeat(24)) } }) as string
  font = run('font.add', { font: { name: 'Brand', family: 'Brand', fileName: 'brand.ttf', data: 'AAAA' } }) as string
  graded = add('Main', 0, 60, { assetId: 'a', name: 'graded' })
  run('clip.update', { ids: [graded], patch: { color: { lut: { id: lut } } } })
  title = add('Titles', 0, 60, { kind: 'text', name: 'title' })
  run('clip.update', { ids: [title], patch: { text: { font: `custom:${font}` } } })
})

/** Every clip of the project, on every timeline, open or not. */
const everyClip = (): Clip[] => [...Object.values(getProject().clips), ...Object.values(getProject().sequences ?? {}).flatMap((s) => Object.values(s.clips))]
const withLut = () => everyClip().filter((c) => c.color.lut?.id === lut).length
const withFont = () => everyClip().filter((c) => c.text?.font === `custom:${font}`).length

describe('removing a LUT from the project', () => {
  it('takes it off the clips of a timeline that isn’t open', () => {
    const copy = run('sequence.duplicate', { id: openSequenceId(getProject()), open: false }) as string
    expect(withLut()).toBe(2)
    run('lut.remove', { id: lut })
    expect(clip(graded).color.lut).toBeUndefined()
    // The copy's clip kept naming a LUT the project no longer has: graded by nothing, and still said to be graded.
    expect(Object.values(getProject().sequences![copy].clips).filter((c) => c.color.lut)).toEqual([])
    expect(withLut()).toBe(0)
  })

  it('takes it off a clip inside a nested timeline', () => {
    run('clip.nest', { ids: [graded] })
    expect(withLut()).toBe(1)
    run('lut.remove', { id: lut })
    expect(withLut()).toBe(0)
  })

  it('takes it off the timeline that was open when it is another that is open now', () => {
    const film = openSequenceId(getProject())
    run('sequence.create', { name: 'Shorts' })
    expect(openSequenceId(getProject())).not.toBe(film)
    run('lut.remove', { id: lut })
    expect(withLut()).toBe(0)
    run('sequence.open', { id: film })
    expect(clip(graded).color.lut).toBeUndefined()
  })

  it('is undone on every timeline at once', () => {
    run('sequence.duplicate', { id: openSequenceId(getProject()), open: false })
    run('lut.remove', { id: lut })
    useEditor.getState().undo()
    expect(getProject().luts?.[lut]?.name).toBe('Teal and orange')
    expect(withLut()).toBe(2)
  })
})

describe('removing a font from the project', () => {
  it('sets the titles of a timeline that isn’t open in the default typeface too', () => {
    const copy = run('sequence.duplicate', { id: openSequenceId(getProject()), open: false }) as string
    expect(withFont()).toBe(2)
    run('font.remove', { id: font })
    expect(clip(title).text?.font).toBe('sans')
    // The copy's title kept the name of a font that is gone: “Missing font”, where the one on the open timeline says the default.
    expect(Object.values(getProject().sequences![copy].clips).filter((c) => c.kind === 'text').map((c) => c.text?.font)).toEqual(['sans'])
    expect(withFont()).toBe(0)
  })

  it('does for a title inside a nested timeline', () => {
    run('clip.nest', { ids: [title] })
    expect(withFont()).toBe(1)
    run('font.remove', { id: font })
    expect(withFont()).toBe(0)
  })

  it('leaves titles set in another font as they are', () => {
    const other = run('font.add', { font: { name: 'Other', family: 'Other', fileName: 'other.ttf', data: 'AAAA' } }) as string
    const second = add('Titles', 60, 60, { kind: 'text', name: 'second' })
    run('clip.update', { ids: [second], patch: { text: { font: `custom:${other}` } } })
    run('sequence.duplicate', { id: openSequenceId(getProject()), open: false })
    run('font.remove', { id: font })
    expect(everyClip().filter((c) => c.text?.font === `custom:${other}`)).toHaveLength(2)
  })
})
