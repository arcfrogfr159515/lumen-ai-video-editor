import { beforeEach, describe, expect, it } from 'vitest'
import { clipEnd, clipsOnTrack } from './ops'
import { openSequenceId } from './sequences'
import { getProject, useEditor } from './store'
import { add, addAsset, freshProject, run, spans } from './test-helpers'
import { problems } from './test-invariants'
import type { Project, Sequence } from './types'

// Removing media takes its clips off every timeline. The main track has no gaps — it closes up after every edit —
// and that holds for a timeline that isn't open as for the one that is: which one is open when the media goes
// makes no difference to what is left.

let film: string

beforeEach(() => {
  freshProject('Cuts')
  addAsset('a', 60)
  addAsset('b', 60)
  addAsset('c', 60)
  film = openSequenceId(getProject())
  add('Main', 0, 60, { assetId: 'a', name: 'a' })
  add('Main', 60, 60, { assetId: 'b', name: 'b' })
  add('Main', 120, 60, { assetId: 'c', name: 'c' })
  expect(spans('Main')).toEqual([[0, 60], [60, 120], [120, 180]])
})

/** A timeline that isn't open, seen as a project of its own. */
const view = (seq: Sequence): Project => ({ ...getProject(), settings: seq.settings, tracks: seq.tracks, clips: seq.clips, markers: seq.markers }) as Project
const stored = (id: string) => getProject().sequences![id]
/** [start, end) of the clips on a stored timeline's track, in order. */
const spansOf = (seq: Sequence, track: string) => clipsOnTrack(view(seq), seq.tracks.find((t) => t.name === track)!.id).map((c) => [c.start, clipEnd(c)])

describe('removing media that a timeline which isn’t open uses', () => {
  it('closes that timeline’s main track up, as it does the open one’s', () => {
    const copy = run('sequence.duplicate', { id: film, open: false }) as string
    run('asset.remove', { ids: ['b'] })
    expect(spans('Main')).toEqual([[0, 60], [60, 120]])
    // The copy was left with a hole where the clip had been: [0, 60] and [120, 180] on a track that has no gaps.
    expect(spansOf(stored(copy), 'Main')).toEqual([[0, 60], [60, 120]])
    expect(problems(view(stored(copy)))).toEqual([])
  })

  it('does when it is the film that isn’t open', () => {
    run('sequence.duplicate', { id: film, open: true })
    expect(openSequenceId(getProject())).not.toBe(film)
    run('asset.remove', { ids: ['a'] })
    expect(spans('Main')).toEqual([[0, 60], [60, 120]])
    expect(spansOf(stored(film), 'Main')).toEqual([[0, 60], [60, 120]])
    expect(problems(view(stored(film)))).toEqual([])
  })

  it('takes what is linked to the clips that move along, as on the open timeline', () => {
    // The sound of the last clip, on a clip of its own: it follows its picture when the main track closes up.
    const last = clipsOnTrack(getProject(), getProject().tracks.find((t) => t.name === 'Main')!.id)[2]
    run('clip.detachAudio', { ids: [last.id] })
    const copy = run('sequence.duplicate', { id: film, open: false }) as string
    run('asset.remove', { ids: ['b'] })
    const sound = (p: Project) => Object.values(p.clips).find((c) => c.kind === 'audio')!
    expect(sound(getProject()).start).toBe(60)
    expect(sound(view(stored(copy))).start).toBe(60)
  })

  it('is undone on every timeline at once', () => {
    const copy = run('sequence.duplicate', { id: film, open: false }) as string
    run('asset.remove', { ids: ['b'] })
    useEditor.getState().undo()
    expect(spans('Main')).toEqual([[0, 60], [60, 120], [120, 180]])
    expect(spansOf(stored(copy), 'Main')).toEqual([[0, 60], [60, 120], [120, 180]])
  })

  it('leaves a timeline that doesn’t use the media as it was', () => {
    const other = run('sequence.create', { name: 'Shorts', open: true }) as string
    add('Main', 0, 30, { assetId: 'c', name: 'only c' })
    run('sequence.open', { id: film })
    const before = stored(other)
    run('asset.remove', { ids: ['b'] })
    expect(stored(other)).toBe(before)
  })
})
