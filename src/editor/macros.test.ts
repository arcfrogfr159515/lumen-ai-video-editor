import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cancelRecording, runMacro, startRecording, stopRecording, useMacros } from './macro-store'
import { exportMacros, generalize, importMacros, instantiate, recordable, type Macro } from './macros'
import { dispatch, getProject, onDispatch, useEditor } from './store'
import { add, addAsset, clip, freshProject, onTrack, run, spans, trackId } from './test-helpers'

let a: string
let b: string

beforeEach(() => {
  cancelRecording()
  useMacros.setState({ macros: [], lastId: null })
  freshProject('Macros')
  addAsset('long', 120)
  // Two clips on the overlay track, in different places and of different lengths.
  a = add('Overlay', 100, 200, { assetId: 'long', inPoint: 300, name: 'A' })
  b = add('Overlay', 700, 320, { assetId: 'long', inPoint: 1500, name: 'B' })
})

/** Lets the recorder note where in history its steps landed (it does so in a microtask). */
const settle = () => new Promise<void>((resolve) => queueMicrotask(resolve))
const steps = () => useMacros.getState().recording!.steps.map((s) => s.command)
const record = async (fn: () => void | Promise<void>, name = 'Test'): Promise<Macro> => {
  startRecording(a)
  await fn()
  await settle()
  return stopRecording(name)!
}

describe('recording', () => {
  it('writes down what is done to the clip, in terms that hold for any clip', async () => {
    const macro = await record(() => {
      run('clip.update', { ids: [a], patch: { color: { contrast: 20 } } })
      run('clip.trim', { id: a, edge: 'end', frame: 290 })
      run('marker.add', { frame: 115 })
    }, 'Tidy')
    expect(macro.name).toBe('Tidy')
    expect(macro.steps.map((s) => [s.command, s.title])).toEqual([
      ['clip.update', 'Edit color'],
      ['clip.trim', 'Trim end'],
      ['marker.add', 'Add marker'],
    ])
    expect(macro.steps[0].input).toEqual({ ids: [{ $clip: true }], patch: { color: { contrast: 20 } } })
    // Ten frames off the end, whatever the clip's length; fifteen frames after its start, wherever it is.
    expect(macro.steps[1].input).toMatchObject({ id: { $clip: true }, edge: 'end', frame: { $frame: { from: 'end', offset: -10 } } })
    expect(macro.steps[2].input).toMatchObject({ frame: { $frame: { from: 'start', offset: 15 } } })
    expect(useMacros.getState()).toMatchObject({ recording: null, lastId: macro.id })
  })

  it('counts a dragged slider as one step', async () => {
    const macro = await record(() => {
      for (const v of [5, 12, 20, 31]) run('clip.update', { ids: [a], patch: { color: { exposure: v } } })
      // A different property is a different step.
      run('clip.update', { ids: [a], patch: { transform: { scale: 1.2 } } })
    })
    expect(macro.steps.map((s) => s.input)).toEqual([
      { ids: [{ $clip: true }], patch: { color: { exposure: 31 } } },
      { ids: [{ $clip: true }], patch: { transform: { scale: 1.2 } } },
    ])
  })

  it('follows what a step makes: a split’s second half, a mask', async () => {
    const macro = await record(() => {
      const [right] = run('clip.split', { frame: 160, ids: [a] }) as string[]
      run('clip.update', { ids: [right], patch: { speed: 2 } })
      const mask = run('mask.add', { clipId: a, mask: { shape: 'ellipse' } }) as string
      run('mask.update', { clipId: a, maskId: mask, patch: { feather: 0.2 } })
    })
    expect(macro.steps[0].input).toEqual({ frame: { $frame: { from: 'start', offset: 60 } }, ids: [{ $clip: true }] })
    expect(macro.steps[1].input).toEqual({ ids: [{ $result: { step: 0, path: '0' } }], patch: { speed: 2 } })
    expect(macro.steps[3].input).toMatchObject({ clipId: { $clip: true }, maskId: { $result: { step: 2, path: '' } } })
  })

  it('names an effect by its kind and a track by how far it is from the clip’s', async () => {
    run('effect.add', { ids: [a], kind: 'grain' })
    const grain = clip(a).effects[0].id
    const macro = await record(() => {
      run('effect.update', { clipId: a, effectId: grain, patch: { amount: 70 } })
      run('clip.move', { moves: [{ id: a, start: 130, trackId: trackId('Titles') }] })
    })
    expect(macro.steps[0].input).toMatchObject({ effectId: { $effect: { kind: 'grain', index: 0 } } })
    expect(macro.steps[1].input).toMatchObject({ moves: [{ id: { $clip: true }, start: { $frame: { from: 'start', offset: 30 } }, trackId: { $track: -1 } }] })
  })

  it('leaves out what isn’t an edit to the clip, and says so', async () => {
    startRecording(a)
    run('track.add', { kind: 'video' })
    run('clip.update', { ids: [b], patch: { color: { contrast: 10 } } })
    run('clip.update', { ids: [a], patch: { color: { contrast: 10 } } })
    expect(steps()).toEqual(['clip.update'])
    expect(useMacros.getState().recording!.skipped).toEqual(['Add video track — macros hold edits to clips, not to media, tracks or timelines', 'Edit color — it wasn’t made to the clip being recorded on'])
    expect(recordable('asset.remove')).toBe(false)
    expect(recordable('take.switch')).toBe(true)
  })

  it('drops a step that is undone, and takes it back on redo', async () => {
    startRecording(a)
    run('clip.update', { ids: [a], patch: { color: { contrast: 10 } } })
    await settle()
    run('effect.add', { ids: [a], kind: 'grain' })
    await settle()
    expect(steps()).toEqual(['clip.update', 'effect.add'])
    useEditor.getState().undo()
    expect(steps()).toEqual(['clip.update'])
    useEditor.getState().redo()
    expect(steps()).toEqual(['clip.update', 'effect.add'])
    useEditor.getState().undo()
    useEditor.getState().undo()
    expect(steps()).toEqual([])
    // A new edit after an undo: the undone steps are gone for good.
    run('clip.update', { ids: [a], patch: { blend: 'screen' } })
    await settle()
    expect(steps()).toEqual(['clip.update'])
  })

  it('never lets something watching an edit make the edit look failed', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const stop = onDispatch(() => {
      throw new Error('a watcher broke')
    })
    try {
      startRecording(a)
      const res = dispatch('clip.update', { ids: [a], patch: { color: { contrast: 15 } } })
      // The edit was made, is in history, and the recorder — another watcher — still saw it.
      expect(res.ok).toBe(true)
      expect(clip(a).color?.contrast).toBe(15)
      expect(useEditor.getState().past.at(-1)?.label).toBe('Edit color')
      expect(steps()).toEqual(['clip.update'])
      expect(error).toHaveBeenCalledTimes(1)
    } finally {
      stop()
      error.mockRestore()
    }
  })

  it('drops only the step that is undone when history is full', () => {
    // History keeps its last 300 edits: from then on it is always 300 deep, whatever is done.
    for (let n = 0; n < 310; n++) run('marker.add', { frame: n })
    expect(useEditor.getState().past).toHaveLength(300)
    startRecording(a)
    run('clip.update', { ids: [a], patch: { color: { contrast: 10 } } })
    run('effect.add', { ids: [a], kind: 'grain' })
    run('clip.trim', { id: a, edge: 'end', frame: 290 })
    expect(steps()).toEqual(['clip.update', 'effect.add', 'clip.trim'])
    useEditor.getState().undo()
    expect(steps()).toEqual(['clip.update', 'effect.add'])
    useEditor.getState().undo()
    expect(steps()).toEqual(['clip.update'])
    useEditor.getState().redo()
    useEditor.getState().redo()
    expect(steps()).toEqual(['clip.update', 'effect.add', 'clip.trim'])
    // An edit made before the recording began isn't a step: undoing down to it takes only the recorded ones.
    for (let n = 0; n < 4; n++) useEditor.getState().undo()
    expect(steps()).toEqual([])
    expect(stopRecording()).toBeNull()
  })

  it('takes every step of an edit made in one go with its undo, and brings them back in order', () => {
    startRecording(a)
    run('clip.update', { ids: [a], patch: { blend: 'screen' } })
    useEditor.getState().transaction('Tidy', 'user', () => {
      run('effect.add', { ids: [a], kind: 'grain' })
      run('clip.trim', { id: a, edge: 'end', frame: 290 })
    })
    expect(steps()).toEqual(['clip.update', 'effect.add', 'clip.trim'])
    useEditor.getState().undo()
    expect(steps()).toEqual(['clip.update'])
    useEditor.getState().redo()
    expect(steps()).toEqual(['clip.update', 'effect.add', 'clip.trim'])
  })

  it('goes back to the setting before when the second of two is undone', () => {
    const patches = () => useMacros.getState().recording!.steps.map((s) => JSON.stringify((s.input as { patch: unknown }).patch))
    startRecording(a)
    // The same setting made twice is one step, the second value — but two edits to undo.
    run('clip.update', { ids: [a], patch: { color: { contrast: 10 } } })
    run('clip.update', { ids: [a], patch: { color: { contrast: 30 } } })
    expect(patches()).toEqual(['{"color":{"contrast":30}}'])
    useEditor.getState().undo()
    expect(clip(a).color?.contrast).toBe(10)
    expect(patches()).toEqual(['{"color":{"contrast":10}}'])
    useEditor.getState().redo()
    expect(patches()).toEqual(['{"color":{"contrast":30}}'])
    useEditor.getState().undo()
    useEditor.getState().undo()
    expect(patches()).toEqual([])
    useEditor.getState().redo()
    useEditor.getState().redo()
    expect(patches()).toEqual(['{"color":{"contrast":30}}'])
    // A slider dragged is one edit: its undo takes the step whole.
    for (const exposure of [5, 12, 20]) dispatch('clip.update', { ids: [a], patch: { color: { exposure } } }, { coalesce: 'exposure' })
    expect(patches()).toEqual(['{"color":{"contrast":30}}', '{"color":{"exposure":20}}'])
    useEditor.getState().undo()
    expect(patches()).toEqual(['{"color":{"contrast":30}}'])
    useEditor.getState().redo()
    expect(patches()).toEqual(['{"color":{"contrast":30}}', '{"color":{"exposure":20}}'])
  })

  it('folds a dragged slider into one step, and keeps edits to different things apart', async () => {
    run('effect.add', { ids: [a], kind: 'grain' })
    run('effect.add', { ids: [a], kind: 'blur' })
    const [grain, blur] = clip(a).effects.map((e) => e.id)
    const c = add('Overlay', 1200, 90, { assetId: 'long', name: 'C' })
    startRecording(a)
    // One slider, dragged: three values, one step.
    for (const amount of [20, 45, 70]) dispatch('effect.update', { clipId: a, effectId: grain, patch: { amount } }, { coalesce: 'fx:grain' })
    // Another effect straight after: its own step, though it sets the same thing.
    run('effect.update', { clipId: a, effectId: blur, patch: { amount: 10 } })
    // The same setting typed twice: the second is what counts.
    run('clip.update', { ids: [a], patch: { color: { contrast: 10 } } })
    run('clip.update', { ids: [a], patch: { color: { contrast: 30 } } })
    await settle()
    expect(useMacros.getState().recording!.steps.map((s) => [s.command, JSON.stringify((s.input as { patch: unknown }).patch)])).toEqual([
      ['effect.update', '{"amount":70}'],
      ['effect.update', '{"amount":10}'],
      ['clip.update', '{"color":{"contrast":30}}'],
    ])
    // An edit to another clip isn't the recorded clip's business — and doesn't swallow the step before it.
    run('clip.update', { ids: [c], patch: { color: { contrast: -5 } } })
    expect(steps()).toHaveLength(3)
    cancelRecording()
  })

  it('keeps two speed changes as two steps: each changes the length the clip had', async () => {
    startRecording(a)
    run('clip.update', { ids: [a], patch: { speed: 2 } })
    run('clip.update', { ids: [a], patch: { speed: 0.5 } })
    await settle()
    expect(steps()).toEqual(['clip.update', 'clip.update'])
    cancelRecording()
    // Dragged in one gesture, they are one.
    startRecording(b)
    for (const speed of [1.2, 1.6, 2]) dispatch('clip.update', { ids: [b], patch: { speed } }, { coalesce: 'speed' })
    await settle()
    expect(steps()).toEqual(['clip.update'])
    cancelRecording()
  })

  it('ends when another project is opened', async () => {
    startRecording(a)
    run('clip.update', { ids: [a], patch: { blend: 'screen' } })
    await settle()
    freshProject('Another')
    expect(useMacros.getState().recording).toBeNull()
    expect(useMacros.getState().macros).toEqual([])
  })

  it('keeps nothing when nothing was recorded, and gives macros names of their own', async () => {
    startRecording(a)
    expect(stopRecording('Empty')).toBeNull()
    const first = await record(() => void run('clip.update', { ids: [a], patch: { blend: 'screen' } }), 'Look')
    const second = await record(() => void run('clip.update', { ids: [a], patch: { blend: 'overlay' } }), 'Look')
    expect([first.name, second.name]).toEqual(['Look', 'Look 2'])
  })
})

describe('replaying', () => {
  it('does the same to another clip, measured from that clip', async () => {
    const macro = await record(() => {
      run('clip.update', { ids: [a], patch: { color: { contrast: 20 } } })
      run('clip.trim', { id: a, edge: 'end', frame: 290 })
      const [right] = run('clip.split', { frame: 160, ids: [a] }) as string[]
      run('clip.update', { ids: [right], patch: { color: { saturation: -100 } } })
      run('marker.add', { frame: 115 })
    })
    const before = useEditor.getState().past.length
    const r = runMacro(macro, [b])
    expect(r).toEqual({ done: 1, failed: [] })
    // B was 700–1020: ten frames off its end, cut sixty frames in, the second half desaturated.
    const pieces = onTrack('Overlay').filter((c) => c.name === 'B')
    expect(pieces.map((c) => [c.start, c.start + c.duration, c.color.contrast, c.color.saturation])).toEqual([
      [700, 760, 20, 0],
      [760, 1010, 20, -100],
    ])
    expect(getProject().markers.map((m) => m.frame)).toEqual([115, 715])
    // One undo step for the whole run.
    expect(useEditor.getState().past.length).toBe(before + 1)
    expect(useEditor.getState().past.at(-1)!.label).toBe('Macro: Test')
    useEditor.getState().undo()
    expect(clip(b)).toMatchObject({ start: 700, duration: 320 })
    expect(clip(b).color.contrast).toBe(0)
  })

  it('runs on several clips, each on its own terms', async () => {
    const c = add('Overlay', 1200, 90, { assetId: 'long', name: 'C' })
    const macro = await record(() => {
      run('clip.trim', { id: a, edge: 'start', frame: 120 })
      run('clip.update', { ids: [a], patch: { audio: { fadeIn: 6 } } })
    })
    expect(runMacro(macro, [c, b]).done).toBe(2)
    expect(spans('Overlay')).toEqual([
      [120, 300],
      [720, 1020],
      [1220, 1290],
    ])
    expect([b, c].map((id) => clip(id).audio.fadeIn)).toEqual([6, 6])
  })

  it('leaves a clip exactly as it was when a step can’t be done to it, and does the others', async () => {
    run('effect.add', { ids: [a, b], kind: 'grain' })
    const c = add('Overlay', 1200, 90, { assetId: 'long', name: 'C' })
    const grain = clip(a).effects[0].id
    const macro = await record(() => {
      run('clip.update', { ids: [a], patch: { color: { contrast: 20 } } })
      run('effect.update', { clipId: a, effectId: grain, patch: { amount: 90 } })
    })
    const r = runMacro(macro, [b, c])
    expect(r.done).toBe(1)
    expect(r.failed).toEqual([{ clipId: c, name: 'C', why: 'step 2 (Edit effect): the clip has no grain effect to change' }])
    expect(clip(b).effects[0].amount).toBe(90)
    // C has no grain: the contrast change the macro had already made to it was taken back too.
    expect(clip(c).color.contrast).toBe(0)
  })

  it('reports a step the timeline refuses', async () => {
    const macro = await record(() => void run('clip.move', { moves: [{ id: a, start: 100, trackId: trackId('Titles') }] }))
    run('track.update', { id: trackId('Titles'), patch: { locked: true } })
    const r = runMacro(macro, [b])
    expect(r.done).toBe(0)
    expect(r.failed[0].why).toMatch(/step 1 \(Move clip\): Titles is locked/)
    expect(clip(b).trackId).toBe(trackId('Overlay'))
  })

  it('measures an edit to a piece from that piece, not from the clip it was cut from', async () => {
    const macro = await record(() => {
      // A is 100–300: cut at 180, then the second piece loses its last 20 frames and its first 10.
      const [right] = run('clip.split', { frame: 180, ids: [a] }) as string[]
      run('clip.trim', { id: right, edge: 'end', frame: 280 })
      run('clip.trim', { id: right, edge: 'start', frame: 190 })
      // The first piece goes: what is done after that is still measured from the second.
      run('clip.delete', { ids: [a], ripple: false })
      run('marker.add', { frame: 200 })
    })
    expect(runMacro(macro, [b])).toEqual({ done: 1, failed: [] })
    // B is 700–1020: cut 80 frames in (780); its second piece ends 20 early (1000) and starts 10 late (790).
    expect(onTrack('Overlay').filter((c) => c.name === 'B').map((c) => [c.start, c.start + c.duration])).toEqual([[790, 1000]])
    expect(getProject().markers.map((m) => m.frame)).toEqual([200, 800])
  })

  it('knows the pieces an edit leaves behind without saying so', async () => {
    const macro = await record(() => {
      // Lifting the middle out of A leaves a piece either side; the one after it is then graded and given an effect.
      run('timeline.liftRange', { start: 150, end: 200 })
      const after = onTrack('Overlay').find((c) => c.start === 200)!
      run('clip.update', { ids: [after.id], patch: { color: { saturation: -100 } } })
      run('effect.add', { ids: [after.id], kind: 'grain', amount: 40 })
      run('effect.update', { clipId: after.id, effectId: clip(after.id).effects[0].id, patch: { amount: 75 } })
    })
    expect(useMacros.getState().macros).toHaveLength(1)
    expect(macro.steps.map((s) => s.command)).toEqual(['timeline.liftRange', 'clip.update', 'effect.add', 'effect.update'])
    expect(runMacro(macro, [b])).toEqual({ done: 1, failed: [] })
    const pieces = onTrack('Overlay').filter((c) => c.name === 'B')
    expect(pieces.map((c) => [c.start, c.start + c.duration, c.color.saturation, c.effects.map((e) => e.amount).join()])).toEqual([
      [700, 750, 0, ''],
      [800, 1020, -100, '75'],
    ])
  })

  it('switches and removes takes by their place in the list', async () => {
    addAsset('other', 60)
    for (const id of [a, b]) {
      run('take.add', { clipId: id, assetId: 'other', inPoint: 0, show: false })
      run('take.add', { clipId: id, assetId: 'other', inPoint: 300, show: false })
    }
    const macro = await record(() => {
      run('take.switch', { clipId: a, takeId: clip(a).takes![2].id })
      run('take.remove', { clipId: a, takeId: clip(a).takes![1].id })
    })
    expect(runMacro(macro, [b])).toEqual({ done: 1, failed: [] })
    expect(clip(b)).toMatchObject({ assetId: 'other', inPoint: 300 })
    expect(clip(b).takes!.map((t) => t.inPoint)).toEqual([1500, 300])
  })

  it('is worth the same time on a timeline at another frame rate', async () => {
    // Recorded at 30 fps: a second off the end, a half-second fade in, a keyframe ten frames in, a 20-frame freeze at the cut.
    const macro = await record(() => {
      run('clip.trim', { id: a, edge: 'end', frame: 270 })
      run('clip.update', { ids: [a], patch: { audio: { fadeIn: 15 } } })
      run('keyframe.set', { clipId: a, prop: 'opacity', frame: 10, value: 0.5 })
      run('clip.freeze', { id: a, frame: 130, duration: 20 })
    })
    expect(macro.fps).toBe(30)
    useEditor.getState().undo()
    useEditor.getState().undo()
    useEditor.getState().undo()
    useEditor.getState().undo()
    // The same project at 60 fps: B is now 1400–2040.
    run('project.update', { settings: { fps: 60 } })
    expect(clip(b)).toMatchObject({ start: 1400, duration: 640 })
    expect(runMacro(macro, [b])).toEqual({ done: 1, failed: [] })
    const pieces = onTrack('Overlay').filter((c) => c.name.startsWith('B'))
    // A second off the end is 60 frames; the freeze, a second in, lasts 40.
    expect(pieces.map((c) => [c.start, c.duration, Boolean(c.freeze)])).toEqual([
      [1400, 60, false],
      [1460, 40, true],
      [1500, 520, false],
    ])
    expect(pieces[0].audio.fadeIn).toBe(30)
    expect(pieces[0].keyframes.opacity?.map((k) => k.frame)).toContain(20)
  })

  it('is not recorded while it runs', async () => {
    const macro = await record(() => void run('clip.update', { ids: [a], patch: { blend: 'screen' } }))
    startRecording(a)
    runMacro(macro, [a])
    expect(steps()).toEqual([])
  })
})

describe('placeholders', () => {
  it('resolve against the clip as it is at that step', () => {
    const p = getProject()
    const ctx = { clipId: b, results: [['clip_new']] }
    const input = instantiate({ command: 'clip.split', title: '', input: { frame: { $frame: { from: 'end', offset: -20 } }, ids: [{ $clip: true }, { $result: { step: 0, path: '0' } }], trackId: { $track: 1 } } }, p, ctx)
    expect(input).toEqual({ frame: 1000, ids: [b, 'clip_new'], trackId: trackId('Main') })
    expect(() => instantiate({ command: 'clip.move', title: '', input: { trackId: { $track: 9 } } }, p, ctx)).toThrow(/no track that far/)
    expect(() => instantiate({ command: 'clip.update', title: '', input: { ids: [{ $result: { step: 3, path: '' } }] } }, p, ctx)).toThrow(/step 4 made nothing/)
    // Nothing about the clip in the input: it comes back as it went in.
    expect(generalize('clip.update', { ids: ['other'], patch: { name: 'x' } }, p, { clipId: a, results: [] })).toEqual({ ids: ['other'], patch: { name: 'x' } })
  })
})

describe('macro files', () => {
  it('round-trip, and refuse what isn’t one', async () => {
    const macro = await record(() => void run('clip.update', { ids: [a], patch: { blend: 'screen' } }), 'Screen it')
    const back = importMacros(exportMacros([macro]))
    expect(back).toEqual([macro])
    expect(() => importMacros('not json')).toThrow(/isn’t a macro file/)
    expect(() => importMacros('{"format":"something-else"}')).toThrow(/isn’t a macro file/)
    // A file can't smuggle in commands a macro doesn't hold.
    const tampered = JSON.parse(exportMacros([macro]))
    tampered.macros.push({ id: 'x', name: 'Bad', steps: [{ command: 'asset.remove', title: 'Remove', input: { ids: ['long'] } }], createdAt: 0 })
    expect(importMacros(JSON.stringify(tampered)).map((m) => m.name)).toEqual(['Screen it'])
  })
})
