import { beforeEach, describe, expect, it } from 'vitest'
import { useMacros } from '@/editor/macro-store'
import { getProject } from '@/editor/store'
import { add, addAsset, clip, freshProject, onTrack, run, spans, trackId, transcript } from '@/editor/test-helpers'
import { agentTools, runAgentTool } from '../agent-tools'

type Json = Record<string, any>

async function call(name: string, args: Record<string, unknown> = {}) {
  const res = await runAgentTool(name, args)
  const text = res.content.find((c) => c.type === 'text')
  return { ...res, json: (res.isError ? { error: text && 'text' in text ? text.text : '' } : res.structuredContent) as Json }
}

beforeEach(() => {
  freshProject('Craft')
  useMacros.setState({ macros: [], lastId: null, recording: null })
})

describe('the craft tools', () => {
  it('are registered, beside the commands they point at', () => {
    const names = new Set(agentTools().map((t) => t.name))
    for (const name of [
      ...['find_gaps', 'find_reused_footage', 'compare_timelines', 'export_markers', 'get_script', 'cut_spoken_text', 'auto_direct_multicam', 'list_macros', 'run_macro', 'check_frame_rates', 'conform_frame_rate', 'list_clip_notes', 'get_storyboard'],
      ...['timeline_closeGaps', 'timeline_mergeFrom', 'timeline_moveRange', 'timeline_threePointEdit', 'sequence_branch', 'take_add', 'take_switch', 'take_remove', 'clip_batch', 'project_setClipColors'],
    ]) {
      expect(names.has(name), name).toBe(true)
    }
  })
})

describe('find_gaps', () => {
  it('lists holes, slivers and flash clips, and timeline_closeGaps clears them', async () => {
    addAsset('a', 60)
    add('Overlay', 0, 90, { assetId: 'a' })
    add('Overlay', 92, 60, { assetId: 'a', inPoint: 300 })
    add('Overlay', 152, 2, { assetId: 'a', inPoint: 600 })
    add('Overlay', 200, 60, { assetId: 'a', inPoint: 900 })
    const found = (await call('find_gaps')).json
    expect(found.clean).toBe(false)
    // Nothing else plays over the sliver, so it is a hole in the film as well as a gap on its track.
    expect(found.holes).toEqual([
      { start: 90, end: 92, from_seconds: 3, to_seconds: 3.067, frames: 2 },
      { start: 154, end: 200, from_seconds: 5.133, to_seconds: 6.667, frames: 46 },
    ])
    expect(found.gaps.filter((g: Json) => g.flash).map((g: Json) => [g.track, g.start, g.end])).toEqual([['Overlay', 90, 92]])
    expect(found.flash_clips.map((c: Json) => [c.start, c.frames])).toEqual([[152, 2]])

    expect((await call('timeline_closeGaps')).json.ok).toBe(true)
    const after = (await call('find_gaps')).json
    expect(after).toMatchObject({ clean: true, holes: [], flash_clips: [] })
  })
})

describe('find_reused_footage', () => {
  it('names the stretch of media that plays twice, and where', async () => {
    addAsset('a', 60)
    add('Overlay', 0, 90, { assetId: 'a', inPoint: 0, name: 'First' })
    add('Overlay', 300, 90, { assetId: 'a', inPoint: 60, name: 'Again' })
    const r = (await call('find_reused_footage')).json
    expect(r.repeated_seconds).toBe(1)
    expect(r.reused).toHaveLength(1)
    expect(r.reused[0]).toMatchObject({ asset_id: 'a', what: 'picture', source_from_seconds: 2, source_to_seconds: 3 })
    expect(r.reused[0].uses.map((u: Json) => [u.name, u.start, u.end])).toEqual([
      ['First', 60, 90],
      ['Again', 300, 330],
    ])
  })

  it('finds nothing in a cut that uses everything once', async () => {
    addAsset('a', 60)
    add('Overlay', 0, 90, { assetId: 'a', inPoint: 0 })
    add('Overlay', 90, 90, { assetId: 'a', inPoint: 90 })
    expect((await call('find_reused_footage')).json).toEqual({ repeated_seconds: 0, reused: [] })
  })
})

describe('compare_timelines', () => {
  it('lists what a branch changed, in the numbers timeline_mergeFrom takes', async () => {
    addAsset('a', 60)
    add('Main', 0, 90, { assetId: 'a', inPoint: 0 })
    const middle = add('Main', 90, 60, { assetId: 'a', inPoint: 300 })
    add('Main', 150, 90, { assetId: 'a', inPoint: 600 })
    const main = (await call('get_project')).json.timeline.id as string
    const branch = (await call('sequence_branch', { name: 'Tighter' })).json.result as string
    // On the branch, the middle shot goes.
    run('clip.delete', { ids: [Object.values(getProject().clips).find((c) => c.start === 90)!.id], ripple: true })
    expect((await call('get_project')).json.timeline).toMatchObject({ id: branch, branch_of: main })

    const there = (await call('compare_timelines')).json
    expect(there.other_timeline).toMatchObject({ id: main, frames: 240 })
    expect(there.differences).toMatchObject([{ kind: 'added', a: { start: 90, end: 90 }, b: { start: 90, end: 150 } }])

    // Back on the main timeline, the branch's cut is taken over.
    run('sequence.open', { id: main })
    const here = (await call('compare_timelines', { timeline_id: branch })).json
    expect(here.other_timeline.branch_of_open).toBe(true)
    expect(here.differences).toMatchObject([{ kind: 'removed', a: { start: 90, end: 150 }, b: { start: 90, end: 90 } }])
    const { a, b } = here.differences[0]
    expect((await call('timeline_mergeFrom', { sequenceId: branch, a, b })).json.ok).toBe(true)
    expect(clip(middle)).toBeUndefined()
    expect((await call('compare_timelines', { timeline_id: branch })).json).toMatchObject({ same: true, differences: [] })
  })

  it('says what to do when there is nothing to compare with', async () => {
    expect((await call('compare_timelines')).json.error).toMatch(/sequence_branch/)
    const open = (await call('get_project')).json.timeline.id
    expect((await call('compare_timelines', { timeline_id: open })).json.error).toMatch(/open timeline/)
    expect((await call('compare_timelines', { timeline_id: 'nope' })).json.error).toMatch(/No timeline with id/)
  })
})

describe('export_markers', () => {
  beforeEach(() => {
    addAsset('a', 120)
    add('Main', 0, 3000, { assetId: 'a' })
    run('marker.add', { frame: 0, label: 'Cold open', kind: 'chapter' })
    run('marker.add', { frame: 900, label: 'The climb', kind: 'chapter' })
    run('marker.add', { frame: 1800, label: 'Summit', kind: 'chapter' })
    run('marker.add', { frame: 400, label: 'Fix the wind noise', kind: 'todo' })
    const done = run('marker.add', { frame: 1200, label: 'Colour pass', kind: 'todo' }) as string
    run('marker.update', { id: done, patch: { done: true } })
  })

  it('writes a chapter list a video site takes', async () => {
    const r = (await call('export_markers', { format: 'youtube' })).json
    expect(r.text).toBe('0:00 Cold open\n0:30 The climb\n1:00 Summit\n')
    expect(r.markers).toBe(3)
    expect(r.warnings).toBeUndefined()
  })

  it('keeps to the kinds asked for, and can leave out what is done', async () => {
    const todos = (await call('export_markers', { format: 'json', kinds: ['todo'] })).json
    expect(JSON.parse(todos.text).markers.map((m: Json) => [m.label, m.done])).toEqual([
      ['Fix the wind noise', false],
      ['Colour pass', true],
    ])
    expect((await call('export_markers', { format: 'json', kinds: ['todo'], open_only: true })).json.markers).toBe(1)
  })

  it('shows the kind of each marker in get_project', async () => {
    const markers = (await call('get_project')).json.markers as Json[]
    expect(markers.find((m) => m.label === 'Colour pass')).toMatchObject({ kind: 'todo', done: true })
    expect(markers.find((m) => m.label === 'Summit')).toMatchObject({ kind: 'chapter' })
  })
})

describe('get_script and cut_spoken_text', () => {
  beforeEach(() => {
    addAsset('talk', 20, 'audio', { transcript: transcript([1, 3, 'So um we drove up to the mountains'], [5, 7, 'The light was was perfect'], [9, 11, 'We drove home']) })
    add('Voice', 0, 600, { assetId: 'talk' })
  })

  it('reads the script with a place for every word', async () => {
    const s = (await call('get_script')).json
    expect(s.words).toBe(16)
    expect(s.lines.map((l: Json) => [l.first_word, l.text])).toEqual([
      [0, 'So um we drove up to the mountains'],
      [8, 'The light was was perfect'],
      [13, 'We drove home'],
    ])
    expect(s.filler_words).toEqual([1])
    expect(s.repeated_words).toEqual([10])
    expect((await call('get_script', { from_seconds: 8 })).json.lines).toHaveLength(1)
  })

  it('cuts a phrase out of the film, closing the timeline up', async () => {
    const before = onTrack('Voice').reduce((n, c) => n + c.duration, 0)
    const r = (await call('cut_spoken_text', { phrases: ['up to the mountains'] })).json
    expect(r).toMatchObject({ words_cut: 4, cuts: 1, text_cut: 'up to the mountains' })
    expect(r.seconds_saved).toBeGreaterThan(0.5)
    const after = onTrack('Voice').reduce((n, c) => n + c.duration, 0)
    expect(before - after).toBe(Math.round(r.seconds_saved * 30))
    expect((await call('get_script')).json.lines[0].text).toBe('So um we drove')
    expect(spans('Voice')[0][0]).toBe(0)
  })

  it('cuts fillers and repeats in one undo step', async () => {
    const r = (await call('cut_spoken_text', { fillers: true, repeats: true })).json
    expect(r).toMatchObject({ words_cut: 2, cuts: 2 })
    const s = (await call('get_script')).json
    // Each cut leaves a join, and a line of the script ends at a join.
    expect(s.lines.map((l: Json) => l.text).join(' / ')).toBe('So / we drove up to the mountains / The light / was perfect / We drove home')
    expect(s.lines.filter((l: Json) => l.cut_through).length).toBe(4)
    await call('undo')
    expect((await call('get_script')).json.words).toBe(16)
  })

  it('asks which one when a phrase is said more than once', async () => {
    const twice = (await call('cut_spoken_text', { phrases: ['we drove'] })).json
    expect(twice.error).toMatch(/said 2 times.*words 2–3.*words 13–14.*all_occurrences/s)
    expect((await call('cut_spoken_text', { phrases: ['we drove'], all_occurrences: true })).json.words_cut).toBe(4)
  })

  it('explains what it can’t find', async () => {
    expect((await call('cut_spoken_text', { phrases: ['to the sea'] })).json.error).toMatch(/Nobody says “to the sea”/)
    expect((await call('cut_spoken_text', { word_indexes: [99] })).json.error).toMatch(/16 words \(0–15\)/)
    expect((await call('cut_spoken_text', {})).json.note).toMatch(/Nothing to cut/)
  })

  it('says so when nothing is transcribed', async () => {
    freshProject('Silent')
    expect((await call('get_script')).json).toMatchObject({ lines: [], words: 0 })
    expect((await call('cut_spoken_text', { fillers: true })).json.error).toMatch(/transcribe_media/)
  })
})

describe('auto_direct_multicam', () => {
  it('needs a multicam clip', async () => {
    expect((await call('auto_direct_multicam')).json.error).toMatch(/create_multicam/)
  })

  describe('on two cameras', () => {
    let clipId: string

    beforeEach(() => {
      // Camera A's mic is loud for the first 10 s, camera B's for the last 10.
      const peaks = (from: number, to: number) => Array.from({ length: 20 * 50 }, (_, i) => (i / 50 >= from && i / 50 < to ? 0.7 + 0.03 * Math.sin(i) : 0.04))
      addAsset('cam_a', 20, 'video', { peaks: peaks(0, 10) })
      addAsset('cam_b', 20, 'video', { peaks: peaks(10, 20) })
      clipId = (run('multicam.create', { angles: [{ assetId: 'cam_a', offset: 0 }, { assetId: 'cam_b', offset: 0 }], audio: 0, place: true, start: 0 }) as { clipId: string }).clipId
    })

    it('plans without cutting on a dry run', async () => {
      const r = (await call('auto_direct_multicam', { dry_run: true, reactions: false })).json
      expect(r.planned_cuts).toBe(1)
      expect(r.cuts.map((c: Json) => [c.angle, c.why])).toEqual([
        [1, 'opening'],
        [2, 'speaker'],
      ])
      expect(r.cuts[1].at_seconds).toBeGreaterThan(9)
      expect(r.cuts[1].at_seconds).toBeLessThanOrEqual(10)
      expect(r.cameras.map((c: Json) => c.share)).toEqual([expect.closeTo(0.5, 1), expect.closeTo(0.5, 1)])
      expect(Object.keys(getProject().clips)).toEqual([clipId])
    })

    it('cuts to whoever speaks, as one undo step made by the AI', async () => {
      const r = (await call('auto_direct_multicam', { reactions: false })).json
      expect(r.cuts_made).toBe(1)
      const pieces = onTrack('Main')
      expect(pieces).toHaveLength(2)
      const project = (await call('get_project')).json
      expect(project.tracks.find((t: Json) => t.name === 'Main').clips.map((c: Json) => c.multicam_angle)).toEqual([1, 2])
      const last = (await call('get_history')).json
      expect(JSON.stringify(last)).toMatch(/Auto-direct multicam/)
    })

    it('refuses a wide camera that isn’t there', async () => {
      expect((await call('auto_direct_multicam', { wide_angle: 5 })).json.error).toMatch(/has 2 cameras/)
    })
  })
})

describe('macros', () => {
  const macro = {
    id: 'macro_1',
    name: 'Warm and tight',
    createdAt: 1,
    steps: [
      { command: 'clip.update' as const, input: { ids: [{ $clip: true }], patch: { color: { temperature: 20 } } }, title: 'Edit color' },
      { command: 'clip.trim' as const, input: { id: { $clip: true }, edge: 'end', frame: { $frame: { from: 'end', offset: -15 } } }, title: 'Trim end' },
    ],
  }

  it('list_macros shows what each macro does', async () => {
    expect((await call('list_macros')).json).toEqual({ macros: [] })
    useMacros.setState({ macros: [macro], lastId: 'macro_1' })
    expect((await call('list_macros')).json.macros).toEqual([{ id: 'macro_1', name: 'Warm and tight', steps: ['Edit color', 'Trim end'], last_used: true }])
  })

  it('run_macro does it to each clip, by id or by name', async () => {
    useMacros.setState({ macros: [macro], lastId: null })
    addAsset('a', 60)
    const one = add('Overlay', 0, 90, { assetId: 'a' })
    const two = add('Overlay', 200, 120, { assetId: 'a' })
    const r = (await call('run_macro', { macro: 'warm and tight', clip_ids: [one, two] })).json
    expect(r).toEqual({ macro: 'Warm and tight', clips_done: 2, skipped: [] })
    expect([clip(one).duration, clip(two).duration]).toEqual([75, 105])
    expect(clip(two).color.temperature).toBe(20)
    expect(JSON.stringify((await call('get_history')).json)).toMatch(/Macro: Warm and tight/)
  })

  it('run_macro explains an unknown macro or clip', async () => {
    expect((await call('run_macro', { macro: 'x', clip_ids: ['c'] })).json.error).toMatch(/recorded no macros/)
    useMacros.setState({ macros: [macro], lastId: null })
    expect((await call('run_macro', { macro: 'x', clip_ids: ['c'] })).json.error).toMatch(/Known: macro_1 \(Warm and tight\)/)
    expect((await call('run_macro', { macro: 'macro_1', clip_ids: ['c'] })).json.error).toMatch(/No clip with id c/)
  })
})

describe('check_frame_rates', () => {
  it('reports what is known about each video and which need a constant-rate copy', async () => {
    addAsset('phone', 30, 'video', { frameTiming: { variable: true, min: 18, max: 60, average: 28.9, median: 29.6, frames: 400 } })
    addAsset('camera', 30, 'video', { frameTiming: { min: 25, max: 25, average: 25, median: 25, grid: 25, frames: 400 } })
    const r = (await call('check_frame_rates')).json
    expect(r.project_fps).toBe(30)
    expect(r.uneven).toEqual(['phone'])
    expect(r.videos.find((v: Json) => v.asset_id === 'phone')).toMatchObject({ uneven: true, suggested_fps: 30 })
    expect(r.videos.find((v: Json) => v.asset_id === 'phone').timing).toMatch(/^Variable/)
    expect(r.videos.find((v: Json) => v.asset_id === 'camera').uneven).toBeUndefined()
    expect((await call('get_project')).json.media.find((m: Json) => m.id === 'phone').uneven_frame_rate).toBe(true)
  })

  it('conform_frame_rate refuses what is not a video on disk', async () => {
    addAsset('song', 30, 'audio')
    expect((await call('conform_frame_rate', { asset_id: 'song' })).json.error).toMatch(/not a video/)
    expect((await call('conform_frame_rate', { asset_id: 'nope' })).json.error).toMatch(/No media with id/)
  })
})

describe('list_clip_notes', () => {
  it('lists notes and tasks in timeline order', async () => {
    addAsset('a', 60)
    const late = add('Overlay', 300, 90, { assetId: 'a', name: 'B-roll' })
    const early = add('Overlay', 0, 90, { assetId: 'a', name: 'Opening' })
    run('clip.update', { ids: [late], patch: { note: 'Too dark', tasks: [{ id: 't1', text: 'Lift the shadows', done: false }, { id: 't2', text: 'Check focus', done: true }] } })
    run('clip.update', { ids: [early], patch: { tasks: [{ id: 't3', text: 'Stabilize', done: true }] } })
    const all = (await call('list_clip_notes')).json
    expect(all).toMatchObject({ tasks: 3, open_tasks: 1 })
    expect(all.clips.map((c: Json) => [c.name, c.at_seconds, c.note, c.tasks.length])).toEqual([
      ['Opening', 0, undefined, 1],
      ['B-roll', 10, 'Too dark', 2],
    ])
    expect((await call('list_clip_notes', { open_only: true })).json.clips.map((c: Json) => c.name)).toEqual(['B-roll'])
    const project = (await call('get_project')).json
    expect(project.tracks.find((t: Json) => t.name === 'Overlay').clips.find((c: Json) => c.id === late)).toMatchObject({ note: 'Too dark', tasks: 2, open_tasks: 1 })
  })
})

describe('get_storyboard', () => {
  it('gives the cards and sections with the frames timeline_moveRange takes', async () => {
    addAsset('a', 60)
    const one = add('Main', 0, 90, { assetId: 'a', inPoint: 0, name: 'One' })
    const two = add('Main', 90, 60, { assetId: 'a', inPoint: 300, name: 'Two' })
    const three = add('Main', 150, 120, { assetId: 'a', inPoint: 600, name: 'Three' })
    run('marker.add', { frame: 150, label: 'Ending', kind: 'chapter' })
    const board = (await call('get_storyboard')).json
    expect(board.story_track).toMatchObject({ id: trackId('Main'), reorderable: true })
    expect(board.sections.map((s: Json) => [s.title, s.start, s.end, s.cards.map((c: Json) => c.name)])).toEqual([
      ['Opening', 0, 150, ['One', 'Two']],
      ['Ending', 150, 270, ['Three']],
    ])
    // The ending goes first.
    const ending = board.sections[1]
    expect((await call('timeline_moveRange', { start: ending.start, end: ending.end, to: 0 })).json.ok).toBe(true)
    expect(onTrack('Main').map((c) => c.id)).toEqual([three, one, two])
  })
})
