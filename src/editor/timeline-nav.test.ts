import { beforeEach, describe, expect, it, vi } from 'vitest'

// Moving the playhead while paused needs nothing of a browser; stopping playback would.
vi.stubGlobal('cancelAnimationFrame', () => {})
vi.stubGlobal('requestAnimationFrame', () => 0)

const { playback, usePlayback } = await import('./playback')
const { openSequenceId } = await import('./sequences')
const { useEditor } = await import('./store')
const { add, addAsset, freshProject, run } = await import('./test-helpers')
const { startTimelineNav } = await import('./timeline-nav')

startTimelineNav()

beforeEach(() => {
  freshProject('Rates')
  addAsset('shot', 60)
  // Thirty seconds of film at 30 frames a second, the playhead ten seconds in.
  add('Overlay', 0, 900, { assetId: 'shot' })
  playback.seek(300)
})

const playhead = () => usePlayback.getState()

describe('the playhead, when the timeline is given another frame rate', () => {
  it('stays on the moment it was on', () => {
    // Every clip, keyframe and marker is re-timed; the playhead kept its frame number — at twice the frames a
    // second it stood at five seconds instead of ten, and at fewer frames a second it could stand past the end.
    run('project.update', { settings: { fps: 60 } })
    expect(playhead()).toMatchObject({ frame: 600, pausedFrame: 600 })
    run('project.update', { settings: { fps: 24 } })
    expect(playhead()).toMatchObject({ frame: 240, pausedFrame: 240 })
    // Undone, the frame rate goes back, and the playhead with it.
    useEditor.getState().undo()
    expect(playhead().frame).toBe(600)
    useEditor.getState().undo()
    expect(playhead().frame).toBe(300)
  })

  it('doesn’t move for a change that isn’t to the frame rate', () => {
    run('project.update', { settings: { width: 1080, height: 1920 } })
    run('project.update', { name: 'Vertical' })
    expect(playhead().frame).toBe(300)
  })
})

describe('the playhead, from one timeline to another', () => {
  it('is each timeline’s own, whatever their frame rates', () => {
    const first = openSequenceId(useEditor.getState().project)
    const other = run('sequence.create', { name: 'Shorts', settings: { fps: 60 }, open: true }) as string
    expect(playhead().frame).toBe(0)
    playback.seek(90)
    run('sequence.open', { id: first })
    expect(playhead().frame).toBe(300)
    run('sequence.open', { id: other })
    expect(playhead().frame).toBe(90)
  })
})
