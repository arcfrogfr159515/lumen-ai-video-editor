import { beforeEach, describe, expect, it } from 'vitest'
import { createEmptyProject } from '@/editor/new-project'
import { clipsOnTrack } from '@/editor/ops'
import { dispatch, getProject, useEditor } from '@/editor/store'
import { timelineView } from '@/editor/timeline-view'
import type { Asset } from '@/editor/types'
import { useUI } from '@/editor/ui-store'
import { timelineActions } from './timeline-actions'

const trackId = (name: string) => getProject().tracks.find((t) => t.name === name)!.id
const clip = (id: string) => getProject().clips[id]
const order = (name: string) => clipsOnTrack(getProject(), trackId(name)).map((c) => c.id)

function asset(id: string): Asset {
  return { id, name: id, kind: 'video', duration: 60, hasAudio: true, source: { type: 'file', url: `${id}.mp4`, mime: 'video/mp4', fileName: `${id}.mp4`, size: 1 }, addedAt: 0 }
}

function add(track: string, start: number, duration: number) {
  const r = dispatch('clip.add', { trackId: trackId(track), kind: 'video', start, duration, assetId: 'long' })
  if (!r.ok) throw new Error(r.error)
  return r.result as string
}

beforeEach(() => {
  useEditor.getState().loadProject(createEmptyProject('Nudge'))
  dispatch('asset.add', { asset: asset('long') })
  useUI.getState().clearSelection()
  timelineView().set({ storyboard: false })
})

describe('nudge selection', () => {
  it('slides a free clip by the frames given, and a run of nudges is one undo', () => {
    const a = add('Overlay', 100, 30)
    useUI.getState().select([a])
    const before = useEditor.getState().past.length
    timelineActions.nudgeSelection(1)
    timelineActions.nudgeSelection(1)
    expect(clip(a).start).toBe(102)
    expect(useEditor.getState().past).toHaveLength(before + 1)
    useEditor.getState().undo()
    expect(clip(a).start).toBe(100)
    timelineActions.nudgeSelection(-5)
    expect(clip(a).start).toBe(95)
  })

  it('stops at 0 and refuses to cover the next clip', () => {
    const a = add('Overlay', 3, 30)
    useUI.getState().select([a])
    timelineActions.nudgeSelection(-5)
    expect(clip(a).start).toBe(0)
    const b = add('Overlay', 30, 30)
    useUI.getState().select([a])
    const before = useEditor.getState().past.length
    timelineActions.nudgeSelection(1)
    expect(clip(a).start).toBe(0)
    expect(clip(b).start).toBe(30)
    expect(useEditor.getState().past).toHaveLength(before)
  })

  it('moves a main-track clip one place, and five places with the bigger nudge', () => {
    const a = add('Main', 0, 10)
    const b = add('Main', 100, 10)
    const c = add('Main', 200, 10)
    const d = add('Main', 300, 10)
    useUI.getState().select([b])
    timelineActions.nudgeSelection(1)
    expect(order('Main')).toEqual([a, c, b, d])
    timelineActions.nudgeSelection(-1)
    expect(order('Main')).toEqual([a, b, c, d])
    useUI.getState().select([a])
    timelineActions.nudgeSelection(5)
    expect(order('Main')).toEqual([b, c, d, a])
  })

  it('keeps a grouped clip at the same offset when the main clip changes places', () => {
    const a = add('Main', 0, 30)
    const b = add('Main', 100, 30)
    const g = add('Overlay', 10, 30)
    dispatch('clip.group', { ids: [a, g] })
    useUI.getState().select([g])
    timelineActions.nudgeSelection(1)
    expect(order('Main')).toEqual([b, a])
    expect(clip(a).start).toBe(30)
    expect(clip(g).start).toBe(40)
  })

  it('slides an ungrouped overlay clip while the main selection changes places', () => {
    const a = add('Main', 0, 30)
    add('Main', 100, 30)
    const title = add('Overlay', 100, 20)
    useUI.getState().select([a, title])
    timelineActions.nudgeSelection(1)
    expect(clip(title).start).toBe(101)
    expect(order('Main')[0]).not.toBe(a)
  })

  it('leaves a locked track where it is', () => {
    const a = add('Overlay', 40, 20)
    dispatch('track.update', { id: trackId('Overlay'), patch: { locked: true } })
    useUI.getState().select([a])
    const before = useEditor.getState().past.length
    timelineActions.nudgeSelection(1)
    expect(clip(a).start).toBe(40)
    expect(useEditor.getState().past).toHaveLength(before)
  })

  it('does nothing on the storyboard, which has its own card nudge', () => {
    const a = add('Overlay', 40, 20)
    useUI.getState().select([a])
    timelineView().set({ storyboard: true })
    timelineActions.nudgeSelection(1)
    expect(clip(a).start).toBe(40)
  })
})
