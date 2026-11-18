import { beforeEach, describe, expect, it } from 'vitest'
import type { CursorTrack } from '@shared/capture'
import { getProject, useEditor } from '@/editor/store'
import { add, addAsset, clip, freshProject, run, trackId } from '@/editor/test-helpers'
import { zoomOnClicks } from './click-actions'

const cursor: CursorTrack = {
  rate: 30,
  moves: [0, 0.5, 0.5, 2, 0.25, 0.25, 6, 0.75, 0.7],
  clicks: [
    { t: 2, x: 0.25, y: 0.25, button: 'left' },
    { t: 6, x: 0.75, y: 0.7, button: 'left' },
  ],
}

let id: string

beforeEach(() => {
  freshProject('Recording')
  addAsset('screen', 10, 'video', { cursor, width: 1920, height: 1080 })
  id = add('Overlay', 0, 300, { assetId: 'screen' })
})

describe('zooms on a recording’s clicks', () => {
  it('are keyframes on the clip, and are taken off again', () => {
    const made = zoomOnClicks(id, { zoom: 2 })
    expect(made.zooms).toHaveLength(2)
    expect(made.keyframes).toBeGreaterThan(0)
    expect(clip(id).keyframes.scale?.length).toBeGreaterThan(0)
    zoomOnClicks(id, { clear: true })
    expect(clip(id).keyframes).toEqual({})
  })

  it('are refused, and said to be, on a recording whose track is locked', () => {
    run('track.update', { id: trackId('Overlay'), patch: { locked: true } })
    const before = getProject()
    const steps = useEditor.getState().past.length
    // Every keyframe is refused one by one — and the answer used to list the zooms all the same, with nothing said
    // in the app and “keyframes: 0” to the Copilot.
    expect(() => zoomOnClicks(id, { zoom: 2 })).toThrow(/is on a locked track/)
    expect(getProject()).toBe(before)
    expect(useEditor.getState().past).toHaveLength(steps)
  })

  it('aren’t taken off a recording whose track is locked, and that is said', () => {
    zoomOnClicks(id, { zoom: 2 })
    run('track.update', { id: trackId('Overlay'), patch: { locked: true } })
    const before = getProject()
    expect(() => zoomOnClicks(id, { clear: true })).toThrow(/is on a locked track/)
    expect(getProject()).toBe(before)
  })
})
