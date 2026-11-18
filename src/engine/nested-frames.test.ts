import { describe, expect, it, vi } from 'vitest'

// A nested timeline is drawn at the frame of its own that the clip playing it shows. At a cut inside it, a frame
// that comes out a hair short is the clip before the cut.

// The transport runs on animation frames and the audio engine, which only a browser has.
vi.mock('@/editor/playback', () => ({ playback: { pause: () => {}, seek: () => {} }, usePlayback: Object.assign(() => 0, { getState: () => ({ frame: 0, playing: false }), subscribe: () => () => {} }) }))

const { mediaDrawnAt } = await import('./compositor')
const { add, addAsset, freshProject, run } = await import('@/editor/test-helpers')
const { dispatch, getProject } = await import('@/editor/store')
const { openSequenceId } = await import('@/editor/sequences')

/**
 * Two clips that meet at `cut`, nested into a timeline of their own played by one clip from the start of the film,
 * at `fps`: what is drawn inside it at frame `at` of the film.
 */
function inside(fps: number, cut: number, at: number, nestedFps = fps) {
  freshProject('Nested')
  dispatch('project.update', { settings: { fps } })
  addAsset('a', 600)
  addAsset('b', 600)
  const before = add('Main', 0, cut, { assetId: 'a', name: 'before' })
  const after = add('Main', cut, 200, { assetId: 'b', name: 'after' })
  const { sequenceId } = run('clip.nest', { ids: [before, after] }) as { clipId: string; sequenceId: string }
  if (nestedFps !== fps) {
    // The nested timeline at another rate than the film: opened, re-timed, and the film opened again.
    const film = openSequenceId(getProject())
    run('sequence.open', { id: sequenceId })
    run('project.update', { settings: { fps: nestedFps } })
    run('sequence.open', { id: film })
  }
  return mediaDrawnAt(getProject(), at).map((d) => `${d.clip.name} @ ${d.local}`)
}

describe('a cut inside a nested timeline', () => {
  it('shows the clip after it from its own first frame', () => {
    // At 25 a second the film's frame 29 was frame 28.999999999999996 of the nested timeline: the clip before the
    // cut once more, with a frame from past where it had been trimmed — in the preview as in an export.
    expect(inside(25, 29, 29)).toEqual(['after @ 0'])
    expect(inside(25, 29, 28)).toEqual(['before @ 28'])
    expect(inside(30, 123, 123)).toEqual(['after @ 0'])
    expect(inside(50, 57, 57)).toEqual(['after @ 0'])
    expect(inside(60, 245, 245)).toEqual(['after @ 0'])
  })

  it('does, wherever the cut falls', () => {
    const late: string[] = []
    for (const fps of [25, 30]) {
      for (let cut = 1; cut <= 150; cut++) {
        const drawn = inside(fps, cut, cut)
        if (drawn.join() !== 'after @ 0') late.push(`${cut} @ ${fps}: ${drawn.join()}`)
      }
    }
    expect(late).toEqual([])
  })

  it('does in a nested timeline at another rate than the film it is in', () => {
    // A film at 25 with a nested timeline at 50: the film's frame 29 is the nested timeline's frame 58, where its cut is.
    expect(inside(25, 29, 29, 50)).toEqual(['after @ 0'])
    expect(inside(25, 29, 28, 50)).toEqual(['before @ 56'])
    // And one at 30 inside a film at 60: its frame 61 is shown by the film's frames 122 and 123.
    expect(inside(60, 122, 122, 30)).toEqual(['after @ 0'])
    expect(inside(60, 122, 123, 30)).toEqual(['after @ 0.5'])
    expect(inside(60, 122, 121, 30)).toEqual(['before @ 60.5'])
  })
})
