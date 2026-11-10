import { beforeEach, describe, expect, it } from 'vitest'
import { batchNames, describeBatch, similarClips } from './batch'
import { getProject, useEditor } from './store'
import { add, addAsset, clip, freshProject, refusal, run, spans } from './test-helpers'

type Result = { changed: number; skipped: { id: string; name: string; why: string }[] }

let a: string
let b: string
let title: string
let music: string

beforeEach(() => {
  freshProject('Batch')
  addAsset('interview', 60)
  addAsset('broll', 60)
  addAsset('song', 120, 'audio')
  a = add('Main', 0, 120, { assetId: 'interview' })
  b = add('Main', 120, 90, { assetId: 'broll' })
  title = add('Titles', 0, 60, { kind: 'text', name: 'Opening title' })
  music = add('Music', 0, 300, { assetId: 'song' })
})

const batch = (input: Omit<Parameters<typeof run<'clip.batch'>>[1], 'ids'>, ids = [a, b, title, music]) => run('clip.batch', { ids, ...input }) as Result

describe('batch operations', () => {
  it('change each clip from where it stands', () => {
    run('clip.update', { ids: [a], patch: { audio: { volume: -6 } } })
    run('clip.update', { ids: [b], patch: { speed: 2 } })
    const r = batch({ volume: { mode: 'offset', value: 3 }, speed: { mode: 'scale', value: 0.5 } })
    expect(clip(a).audio.volume).toBe(-3)
    expect(clip(b).audio.volume).toBe(3)
    expect(clip(music).audio.volume).toBe(3)
    // a was real time and is now half speed; b was 2× and is back to real time.
    expect(clip(a).speed).toBe(0.5)
    expect(clip(b).speed).toBe(1)
    expect(r.changed).toBe(3)
    // The title has neither sound nor speed: said once for each.
    expect(r.skipped.map((s) => [s.name, s.why])).toEqual([
      ['Opening title', 'no speed to change'],
      ['Opening title', 'no sound'],
    ])
  })

  it('keep the same footage when the speed changes, the main track closing up', () => {
    batch({ speed: { mode: 'scale', value: 2 } }, [a, b])
    expect(spans('Main')).toEqual([
      [0, 60],
      [60, 105],
    ])
    batch({ speed: { mode: 'set', value: 1 } }, [a, b])
    expect(spans('Main')).toEqual([
      [0, 120],
      [120, 210],
    ])
  })

  it('stay within what a clip can do', () => {
    batch({ volume: { mode: 'offset', value: 40 }, speed: { mode: 'scale', value: 100 } }, [a])
    expect(clip(a).audio.volume).toBe(12)
    expect(clip(a).speed).toBe(16)
    batch({ volume: { mode: 'set', value: -70 } }, [a])
    expect(clip(a).audio.volume).toBe(-60)
  })

  it('move volume keyframes with an offset, and leave them alone when a level is set', () => {
    run('keyframe.set', { clipId: music, prop: 'volume', frame: 0, value: -12 })
    run('keyframe.set', { clipId: music, prop: 'volume', frame: 100, value: 0 })
    batch({ volume: { mode: 'offset', value: -4 } }, [music])
    expect(clip(music).keyframes.volume!.map((k) => k.value)).toEqual([-16, -4])
    const r = batch({ volume: { mode: 'set', value: -20 } }, [music, a])
    expect(clip(music).keyframes.volume!.map((k) => k.value)).toEqual([-16, -4])
    expect(clip(a).audio.volume).toBe(-20)
    expect(r.skipped[0].why).toMatch(/keyframed/)
  })

  it('set fades no longer than half a clip', () => {
    const r = batch({ fadeIn: 15, fadeOut: 200 })
    expect(clip(music).audio).toMatchObject({ fadeIn: 15, fadeOut: 150 })
    expect(clip(b).audio).toMatchObject({ fadeIn: 15, fadeOut: 45 })
    expect(r.changed).toBe(3)
  })

  it('add, remove and switch effects on every clip with a picture', () => {
    batch({ effects: { add: ['vignette', 'grain'] } })
    expect(clip(a).effects.map((e) => e.kind)).toEqual(['vignette', 'grain'])
    expect(clip(title).effects).toHaveLength(2)
    expect(clip(music).effects).toHaveLength(0)
    // Adding one that is already there leaves it as it is.
    const again = batch({ effects: { add: ['grain'] } }, [a])
    expect(again.changed).toBe(0)
    batch({ effects: { enabled: false } }, [a, b])
    expect(clip(a).effects.every((e) => !e.enabled)).toBe(true)
    batch({ effects: { remove: ['grain'] } }, [a])
    expect(clip(a).effects.map((e) => e.kind)).toEqual(['vignette'])
    batch({ effects: { remove: 'all' } })
    expect(clip(b).effects).toEqual([])
  })

  it('set picture properties, moving scale keyframes with a scaling', () => {
    run('keyframe.set', { clipId: b, prop: 'scale', frame: 0, value: 1 })
    run('keyframe.set', { clipId: b, prop: 'scale', frame: 60, value: 1.2 })
    const r = batch({ opacity: 0.5, scale: { mode: 'scale', value: 1.5 }, blend: 'screen', reverse: true, label: 'teal' })
    expect(clip(a).transform).toMatchObject({ opacity: 0.5, scale: 1.5 })
    expect(clip(b).keyframes.scale!.map((k) => k.value)).toEqual([1.5, 1.8])
    expect(clip(a).blend).toBe('screen')
    expect(clip(a).reverse).toBe(true)
    expect(clip(music).reverse).toBe(true)
    expect([a, b, title, music].map((id) => clip(id).label)).toEqual(['teal', 'teal', 'teal', 'teal'])
    expect(clip(music).blend).toBe('normal')
    expect(r.skipped.some((s) => s.name === 'song' && s.why === 'no picture')).toBe(true)
    batch({ label: null })
    expect('label' in clip(a)).toBe(false)
  })

  it('rename by pattern, numbering in timeline order', () => {
    const later = add('Overlay', 400, 50, { assetId: 'broll' })
    batch({ rename: 'Shot {nn} · {source}' }, [later, b, a])
    expect([a, b, later].map((id) => clip(id).name)).toEqual(['Shot 01 · interview', 'Shot 02 · broll', 'Shot 03 · broll'])
    batch({ rename: '{track} {n} at {tc} ({name})' }, [title])
    expect(clip(title).name).toBe('Titles 1 at 00:00:00:00 (Opening title)')
    expect(refusal('clip.batch', { ids: [a], rename: '   ' })).toMatch(/without a name/)
    expect(batchNames(getProject(), [a], '{nope}')?.get(a)).toBe('{nope}')
  })

  it('are one undo step, and refuse locked tracks', () => {
    const before = useEditor.getState().past.length
    batch({ volume: { mode: 'offset', value: -2 }, opacity: 0.8, rename: 'Clip {n}', effects: { add: ['blur'] } })
    expect(useEditor.getState().past.length).toBe(before + 1)
    expect(useEditor.getState().past.at(-1)!.label).toBe('Batch-edit 4 clips')
    useEditor.getState().undo()
    expect(clip(a)).toMatchObject({ name: 'interview' })
    expect(clip(a).audio.volume).toBe(0)
    run('track.update', { id: getProject().tracks.find((t) => t.name === 'Music')!.id, patch: { locked: true } })
    expect(refusal('clip.batch', { ids: [a, music], opacity: 0.5 })).toMatch(/locked/)
  })

  it('say nothing changed when nothing did', () => {
    const r = batch({ volume: { mode: 'offset', value: 0 }, speed: { mode: 'scale', value: 1 }, opacity: 1 }, [a])
    expect(r).toEqual({ changed: 0, skipped: [] })
    expect(describeBatch(r)).toEqual({ title: 'Nothing changed' })
    expect(describeBatch({ changed: 2, skipped: [{ name: 'Title', why: 'no sound' }, { name: 'A', why: 'no picture' }, { name: 'B', why: 'no picture' }] })).toEqual({
      title: 'Changed 2 clips',
      description: 'Left alone: “Title” (no sound), 2 clips (no picture).',
    })
  })
})

describe('picking clips that belong together', () => {
  it('finds the rest of a track, a source, a kind, a label or a speaker', () => {
    const more = add('Main', 210, 60, { assetId: 'interview', inPoint: 300 })
    const p = () => getProject()
    expect(similarClips(p(), [a], 'track')).toEqual([a, b, more])
    expect(similarClips(p(), [a], 'source')).toEqual([a, more])
    expect(similarClips(p(), [title], 'kind')).toEqual([title])
    expect(similarClips(p(), [a, music], 'kind')).toEqual([a, music, b, more])
    run('clip.update', { ids: [a, music], patch: { label: 'red', speaker: 'Anna' } })
    expect(similarClips(p(), [a], 'label')).toEqual([a, music])
    expect(similarClips(p(), [music], 'speaker')).toEqual([a, music])
    // Nothing to go by: the selection stays as it is.
    expect(similarClips(p(), [b], 'label')).toEqual([b])
  })
})
