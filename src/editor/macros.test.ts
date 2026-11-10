import { beforeEach, describe, expect, it } from 'vitest'
import { cancelRecording, runMacro, startRecording, stopRecording, useMacros } from './macro-store'
import { exportMacros, generalize, importMacros, instantiate, recordable, type Macro } from './macros'
import { getProject, useEditor } from './store'
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
