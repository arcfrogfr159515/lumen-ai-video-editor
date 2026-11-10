import { beforeEach, describe, expect, it } from 'vitest'
import { clipTint, colorLegend, ruleMatches, speakerOf } from './clip-colors'
import { addTask, clipNotes, notesMarkdown, removeTask, taskCounts, toggleTask } from './notes'
import { getProject } from './store'
import { add, addAsset, clip, freshProject, run, trackId } from './test-helpers'

const tint = (id: string) => clipTint(getProject(), clip(id))

beforeEach(() => {
  freshProject('Colours')
  addAsset('cam_a', 60, 'video', { name: 'Interview CAM A.mp4', tags: ['interview', 'speaker: Anna'] })
  addAsset('cam_b', 60, 'video', { name: 'Interview CAM B.mp4' })
  addAsset('drone', 60, 'video', { tags: ['b-roll', 'drone'] })
})

describe('clip colours', () => {
  it('leave clips the colour of their kind until the project says otherwise', () => {
    const a = add('Main', 0, 100, { assetId: 'cam_a' })
    expect(tint(a)).toBeNull()
  })

  it('give every source its own colour, in the order they first play', () => {
    const a = add('Main', 0, 100, { assetId: 'cam_a' })
    const b = add('Main', 100, 100, { assetId: 'cam_b' })
    const a2 = add('Main', 200, 100, { assetId: 'cam_a', inPoint: 300 })
    run('project.setClipColors', { auto: 'source' })
    expect(tint(a)?.color).toBe('blue')
    expect(tint(b)?.color).toBe('orange')
    expect(tint(a2)?.color).toBe('blue')
    expect(tint(a)?.from).toBe('auto')
    // Reordering the clips changes nothing but who comes first.
    run('clip.move', { moves: [{ id: b, start: 0 }] })
    expect(tint(b)?.color).toBe('blue')
    expect(tint(a)?.color).toBe('orange')
  })

  it('check rules before automatic colours, and a label on the clip before both', () => {
    const a = add('Main', 0, 100, { assetId: 'cam_a' })
    const d = add('Overlay', 0, 100, { assetId: 'drone' })
    run('project.setClipColors', {
      auto: 'source',
      rules: [
        { field: 'tag', value: 'B-ROLL', color: 'green' },
        { field: 'source', value: 'cam a', color: 'red' },
      ],
    })
    expect(tint(d)).toMatchObject({ color: 'green', from: 'rule', why: 'tag “B-ROLL”' })
    expect(tint(a)).toMatchObject({ color: 'red', from: 'rule' })
    run('clip.update', { ids: [a], patch: { label: 'purple' } })
    expect(tint(a)).toMatchObject({ color: 'purple', from: 'label' })
    run('clip.update', { ids: [a], patch: { label: null } })
    expect(tint(a)?.color).toBe('red')
    expect(colorLegend(getProject())).toEqual([
      { label: 'source “cam a”', color: 'red', clips: 1 },
      { label: 'tag “B-ROLL”', color: 'green', clips: 1 },
    ])
  })

  it('colour by speaker: said on the clip, tagged on the media, or named by its cue sheet', () => {
    addAsset('scene', 60, 'video', {
      cues: [
        { at: 1, kind: 'line', label: 'Hello', who: 'Ben', seconds: 2 },
        { at: 10, kind: 'line', label: 'Well…', who: 'Cleo', seconds: 6 },
        { at: 17, kind: 'line', label: 'Right.', who: 'Ben', seconds: 1 },
      ],
    })
    const tagged = add('Main', 0, 100, { assetId: 'cam_a' })
    const opening = add('Main', 100, 150, { assetId: 'scene' })
    const later = add('Main', 250, 300, { assetId: 'scene', inPoint: 270 })
    const silent = add('Main', 550, 100, { assetId: 'drone' })
    expect(speakerOf(getProject(), clip(tagged))).toBe('Anna')
    expect(speakerOf(getProject(), clip(opening))).toBe('Ben')
    // From 9 s to 19 s Cleo talks for longer than Ben.
    expect(speakerOf(getProject(), clip(later))).toBe('Cleo')
    expect(speakerOf(getProject(), clip(silent))).toBeUndefined()
    run('clip.update', { ids: [later], patch: { speaker: 'Dee' } })
    run('project.setClipColors', { auto: 'speaker' })
    expect([tagged, opening, later].map((id) => tint(id)?.color)).toEqual(['blue', 'orange', 'green'])
    expect(tint(silent)).toBeNull()
  })

  it('match rules on whole kinds and angle numbers, and on part of a name', () => {
    const a = add('Main', 0, 100, { assetId: 'cam_a', name: 'Wide shot' })
    const p = getProject()
    expect(ruleMatches(p, clip(a), { field: 'kind', value: 'video' })).toBe(true)
    expect(ruleMatches(p, clip(a), { field: 'kind', value: 'vid' })).toBe(false)
    expect(ruleMatches(p, clip(a), { field: 'name', value: 'wide' })).toBe(true)
    expect(ruleMatches(p, clip(a), { field: 'track', value: 'main' })).toBe(true)
    expect(ruleMatches(p, clip(a), { field: 'angle', value: '1' })).toBe(false)
    expect(ruleMatches(p, clip(a), { field: 'speaker', value: '*' })).toBe(true)
    expect(ruleMatches(p, clip(a), { field: 'tag', value: '' })).toBe(false)
  })

  it('colour multicam clips by the camera they show', () => {
    const made = run('multicam.create', { angles: [{ assetId: 'cam_a', offset: 0 }, { assetId: 'cam_b', offset: 0 }], audio: 0, place: true, start: 0 }) as { clipId: string }
    const second = run('multicam.switch', { frame: 200, angle: 2 }) as string
    run('project.setClipColors', { auto: 'angle', rules: [] })
    expect(tint(made.clipId)?.color).toBe('blue')
    expect(tint(second)?.color).toBe('orange')
    expect(ruleMatches(getProject(), clip(second), { field: 'angle', value: '2' })).toBe(true)
  })

  it('go back to colouring by kind, leaving nothing in the project', () => {
    run('project.setClipColors', { auto: 'track' })
    expect(getProject().clipColors).toEqual({ auto: 'track', rules: [] })
    run('project.setClipColors', { auto: null })
    expect('clipColors' in getProject()).toBe(false)
  })
})

describe('clip notes and tasks', () => {
  it('stay on the clip through edits, copies and undo', () => {
    const a = add('Main', 0, 200, { assetId: 'cam_a' })
    const tasks = addTask(addTask(undefined, 'Fix white balance'), ' Remove the cough ')
    run('clip.update', { ids: [a], patch: { note: '  Best take.  ', tasks } })
    expect(clip(a).note).toBe('Best take.')
    expect(clip(a).tasks?.map((t) => t.text)).toEqual(['Fix white balance', 'Remove the cough'])
    run('clip.move', { moves: [{ id: a, start: 0, trackId: trackId('Overlay') }] })
    expect(clip(a).note).toBe('Best take.')
    const [copy] = run('clip.duplicate', { ids: [a] }) as string[]
    expect(clip(copy).tasks).toHaveLength(2)
    run('clip.update', { ids: [a], patch: { note: null, tasks: null } })
    expect('note' in clip(a)).toBe(false)
    expect('tasks' in clip(a)).toBe(false)
  })

  it('stay with the first piece when the clip is cut, however many times', () => {
    const a = add('Overlay', 0, 300, { assetId: 'cam_a' })
    run('clip.update', { ids: [a], patch: { note: 'Too dark', label: 'red', speaker: 'Anna', tasks: addTask(undefined, 'Lift the shadows') } })
    // Three cuts, a stretch taken out, and a freeze frame: one clip has become six.
    run('clip.split', { frame: 100, ids: [a] })
    run('clip.split', { frame: 200 })
    run('timeline.removeRange', { start: 40, end: 60 })
    run('clip.freeze', { id: a, frame: 20, duration: 10 })
    const p = getProject()
    expect(Object.keys(p.clips)).toHaveLength(6)
    // The note and its task are still written once, on the piece that is still that clip.
    expect(clipNotes(p).map((r) => [r.clipId, r.note, r.tasks.length])).toEqual([[a, 'Too dark', 1]])
    expect(taskCounts(p)).toEqual({ clips: 1, tasks: 1, open: 1 })
    // What the footage is — its colour, who speaks in it — goes with every piece.
    expect(Object.values(p.clips).every((c) => c.label === 'red' && c.speaker === 'Anna')).toBe(true)
  })

  it('read back as one list for the timeline', () => {
    const a = add('Main', 0, 200, { assetId: 'cam_a', name: 'Anna answers' })
    const b = add('Main', 200, 200, { assetId: 'cam_b', name: 'Cutaway' })
    add('Main', 400, 200, { assetId: 'drone' })
    let tasks = addTask(addTask(undefined, 'Denoise'), 'Subtitle the name')
    tasks = toggleTask(tasks, tasks[0].id)
    run('clip.update', { ids: [b], patch: { tasks } })
    run('clip.update', { ids: [a], patch: { note: 'Check the release form' } })
    const p = getProject()
    expect(clipNotes(p).map((r) => [r.name, r.open])).toEqual([
      ['Anna answers', 0],
      ['Cutaway', 1],
    ])
    expect(clipNotes(p, { openOnly: true }).map((r) => r.name)).toEqual(['Cutaway'])
    expect(clipNotes(p, { text: 'release' }).map((r) => r.name)).toEqual(['Anna answers'])
    expect(taskCounts(p)).toEqual({ clips: 2, tasks: 2, open: 1 })
    expect(removeTask(tasks, tasks[1].id)).toHaveLength(1)
    const md = notesMarkdown(p)
    expect(md).toContain('## `00:00:06:20` Cutaway (Main)')
    expect(md).toContain('- [x] Denoise\n- [ ] Subtitle the name')
  })
})
