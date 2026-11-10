/**
 * Random edits, checked after every one: whatever commands are thrown at a
 * timeline, in whatever order, it stays a timeline — no clips on top of each
 * other, the main track edge to edge, nothing past the end of its footage,
 * tracks that don't follow ripples left alone, and undo putting back exactly
 * what was there.
 */
import { describe, expect, it } from 'vitest'
import { commands, type CommandInput, type CommandName } from './commands'
import { clipEnd, clipsOnTrack, followsRipple, trackAccepts } from './ops'
import { dispatch, getProject, useEditor } from './store'
import { asset } from './test-helpers'
import { MEDIA, problems, rng, setUp, type Rng } from './test-invariants'
import type { Clip, Project } from './types'

/** A project as text that doesn't depend on the order things were added in (undo puts a deleted clip back last). */
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : v))

/** The clips of each track that doesn't follow ripples (but for one the edit is made on), to see that a ripple left them alone. */
const still = (p: Project, except?: string) =>
  JSON.stringify(
    p.tracks
      .filter((t) => !followsRipple(t) && t.id !== except)
      .map((t) => [t.id, clipsOnTrack(p, t.id).map((c) => [c.id, c.start, c.duration, c.inPoint])]),
  )

/** Everything on the locked tracks: no edit may touch it. */
const locked = (p: Project) => canonical(p.tracks.filter((t) => t.locked).map((t) => [t.id, clipsOnTrack(p, t.id)]))

/**
 * Commands that may change a locked track: its own switches, media leaving the
 * project (its clips go with it) — and adding a clip or a copy of one, which
 * the command layer has always allowed (the interface doesn't offer it).
 */
const REACHES_LOCKED = new Set(['track.update', 'track.remove', 'asset.remove', 'project.update', 'clip.add', 'clip.duplicate'])

// ─── Random edits ────────────────────────────────────────────────────────

/** An edit to try. `ripples`: it moves the whole timeline, so tracks that don't follow ripples must come out as they were — but for the track it is made on. */
type Try = { name: CommandName; input: unknown; ripples?: boolean | { on: string } }

const clipsOf = (p: Project) => Object.values(p.clips)
const end = (p: Project) => Math.max(0, ...clipsOf(p).map(clipEnd))

function someEdit(r: Rng): Try | null {
  const p = getProject()
  const clips = clipsOf(p)
  const total = end(p)
  const frame = () => r.int(0, total + 30)
  const anyClip = (accept: (c: Clip) => boolean = () => true) => {
    const fit = clips.filter(accept)
    return fit.length ? r.pick(fit) : undefined
  }
  const media = (c: Clip) => c.kind === 'video' || c.kind === 'audio' || c.kind === 'image'
  const ids = (n: number) => [...new Set(Array.from({ length: n }, () => r.pick(clips).id))]
  const stretch = (): [number, number] => {
    const a = r.int(0, Math.max(1, total))
    return [a, a + r.int(1, Math.max(2, Math.round(total / 3)))]
  }

  const kind = clips.length < 4 ? 'add' : r.pick(['add', 'add', 'split', 'delete', 'trim', 'move', 'removeRange', 'closeGaps', 'moveRange', 'threePoint', 'threePoint', 'takeAdd', 'takeAdd', 'takeSwitch', 'takeSwitch', 'takeRemove', 'batch', 'locks', 'marker', 'speed', 'ramp', 'duplicate', 'slip', 'update', 'liftRange', 'freeze', 'roll', 'paste', 'nest', 'dropMedia', 'attributes'] as const)
  switch (kind) {
    case 'add': {
      const track = r.pick(p.tracks.filter((t) => t.role !== 'captions'))
      if (track.role === 'titles') return { name: 'clip.add', input: { trackId: track.id, kind: 'text', start: frame(), duration: r.int(1, 90), mode: r.pick(['free', 'overwrite', 'insert']) } }
      const audio = track.kind === 'audio'
      const assetId = audio ? r.pick(['a1', 'a2']) : r.pick(['v1', 'v2', 'v3', 'still'])
      const seconds = (MEDIA as Record<string, number>)[assetId] ?? 30
      const inPoint = assetId === 'still' ? 0 : r.int(0, Math.max(0, seconds * 30 - 60))
      const duration = assetId === 'still' ? r.int(1, 120) : r.int(1, Math.min(240, seconds * 30 - inPoint))
      return { name: 'clip.add', input: { trackId: track.id, kind: audio ? 'audio' : assetId === 'still' ? 'image' : 'video', assetId, start: frame(), duration, inPoint, mode: r.pick(['free', 'free', 'overwrite', 'insert']) } }
    }
    case 'split':
      return { name: 'clip.split', input: r.chance(0.5) ? { frame: frame() } : { frame: frame(), ids: ids(2) } }
    case 'delete': {
      const ripple = r.chance(0.5)
      return { name: 'clip.delete', input: { ids: ids(r.int(1, 2)), ripple } }
    }
    case 'trim': {
      const c = r.pick(clips)
      return { name: 'clip.trim', input: { id: c.id, edge: r.pick(['start', 'end']), frame: r.int(Math.max(0, c.start - 40), clipEnd(c) + 40), ripple: r.chance(0.5) } }
    }
    case 'move': {
      const c = r.pick(clips)
      const tracks = p.tracks.filter((t) => trackAccepts(t, c.kind))
      return { name: 'clip.move', input: { moves: [{ id: c.id, start: frame(), trackId: r.pick(tracks).id }], mode: r.pick(['free', 'overwrite', 'insert']) } }
    }
    case 'removeRange': {
      const [a, b] = stretch()
      return { name: 'timeline.removeRange', input: { start: a, end: b, keepWhole: r.chance(0.3) ? clips.filter((c) => c.kind === 'audio').map((c) => c.id) : [] }, ripples: true }
    }
    case 'liftRange': {
      const [a, b] = stretch()
      return { name: 'timeline.liftRange', input: { start: a, end: b } }
    }
    case 'closeGaps': {
      const named = r.chance(0.4) ? [r.pick(p.tracks).id] : []
      const input = { holes: r.chance(0.8), flashGaps: r.chance(0.8), flashClips: r.chance(0.7), flashFrames: r.int(1, 12), trackIds: named }
      // Filling a sliver or dropping a flash clip changes a track in place; closing holes alone is a ripple.
      return { name: 'timeline.closeGaps', input, ripples: !named.length && !input.flashGaps && !input.flashClips }
    }
    case 'moveRange': {
      const [a, b] = stretch()
      const to = r.chance(0.5) ? r.int(0, a) : r.int(b, Math.max(b, total))
      return { name: 'timeline.moveRange', input: { start: a, end: b, to, keepWhole: r.chance(0.3) ? clips.filter((c) => c.kind === 'audio').map((c) => c.id) : [] }, ripples: true }
    }
    case 'threePoint': {
      const track = r.pick(p.tracks.filter((t) => t.role !== 'titles' && t.role !== 'captions'))
      const assetId = track.kind === 'audio' ? r.pick(['a1', 'a2']) : r.pick(['v1', 'v2', 'v3'])
      const length = (MEDIA as Record<string, number>)[assetId] * 30
      const input: Record<string, unknown> = { assetId, trackId: track.id, at: frame(), mode: r.pick(['insert', 'overwrite']), fit: r.pick(['fit', 'source', 'timeline']), useRange: false }
      if (r.chance(0.7)) input.sourceIn = r.int(0, length - 2)
      if (r.chance(0.6)) input.sourceOut = r.int(((input.sourceIn as number) ?? 0) + 1, length)
      if (r.chance(0.5)) input.timelineIn = frame()
      if (r.chance(0.5)) input.timelineOut = ((input.timelineIn as number) ?? frame()) + r.int(1, 200)
      return { name: 'timeline.threePointEdit', input, ...(input.mode === 'insert' ? { ripples: { on: track.id } } : {}) }
    }
    case 'takeAdd': {
      const c = anyClip(media)
      if (!c) return null
      const audio = p.tracks.find((t) => t.id === c.trackId)?.kind === 'audio'
      const assetId = audio ? r.pick(['a1', 'a2']) : r.pick(['v1', 'v2', 'v3', 'still'])
      return { name: 'take.add', input: { clipId: c.id, assetId, inPoint: r.int(0, 2000), show: r.chance(0.6), ...(r.chance(0.2) ? { speed: r.pick([0.5, 2, 1.5]) } : {}) } }
    }
    case 'takeSwitch': {
      const c = anyClip((x) => Boolean(x.takes?.length))
      if (!c) return null
      return { name: 'take.switch', input: r.chance(0.5) ? { clipId: c.id, step: r.pick([1, -1, 2]) } : { clipId: c.id, takeId: r.pick(c.takes!).id } }
    }
    case 'takeRemove': {
      const c = anyClip((x) => Boolean(x.takes?.length))
      if (!c) return null
      return { name: 'take.remove', input: r.chance(0.2) ? { clipId: c.id, all: true } : { clipId: c.id, takeId: r.pick(c.takes!).id } }
    }
    case 'batch':
      return {
        name: 'clip.batch',
        input: {
          ids: ids(r.int(1, 4)),
          ...(r.chance(0.5) ? { speed: { mode: r.pick(['set', 'scale']), value: r.pick([0.5, 0.75, 1, 1.5, 2, 3]) } } : {}),
          ...(r.chance(0.4) ? { volume: { mode: r.pick(['set', 'offset']), value: r.int(-12, 6) } } : {}),
          ...(r.chance(0.3) ? { fadeIn: r.int(0, 40), fadeOut: r.int(0, 40) } : {}),
          ...(r.chance(0.2) ? { reverse: r.chance(0.5) } : {}),
          ...(r.chance(0.2) ? { rename: 'Shot {nn} {name}' } : {}),
          ...(r.chance(0.2) ? { effects: { add: ['blur'] } } : {}),
          ...(r.chance(0.2) ? { label: r.pick(['red', 'blue', null]) } : {}),
        },
      }
    case 'locks': {
      const t = r.pick(p.tracks)
      return { name: 'track.update', input: { id: t.id, patch: r.pick([{ syncLock: false }, { syncLock: true }, { rippleLock: true }, { rippleLock: false }, { locked: true }, { locked: false }, { locked: false, syncLock: true, rippleLock: false }]) } }
    }
    case 'marker':
      return { name: 'marker.add', input: { frame: frame(), kind: r.pick(['chapter', 'todo', 'comment', undefined]) } }
    case 'speed': {
      const c = anyClip(media)
      return c ? { name: 'clip.update', input: { ids: [c.id], patch: { speed: r.pick([0.25, 0.5, 1, 1.25, 2, 4]) } } } : null
    }
    case 'ramp': {
      const c = anyClip((x) => x.kind === 'video' || x.kind === 'audio')
      if (!c) return null

      return { name: 'clip.setSpeedRamp', input: { id: c.id, points: r.chance(0.25) ? null : [{ at: 0, speed: r.pick([0.5, 1, 2]) }, { at: r.pick([0.3, 0.5, 0.7]), speed: r.pick([0.25, 1, 3]), easing: r.pick(['linear', 'ease', 'cubic-bezier(0.2, 0, 0.1, 1)']) }, { at: 1, speed: r.pick([0.5, 1, 2]) }] } }
    }

    case 'duplicate':
      return { name: 'clip.duplicate', input: { ids: ids(1) } }
    case 'slip': {
      const c = anyClip(media)
      return c ? { name: 'clip.slip', input: { id: c.id, frames: r.int(-60, 60) } } : null
    }
    case 'update': {
      const c = r.pick(clips)
      return { name: 'clip.update', input: { ids: [c.id], patch: r.pick([{ note: 'Check this' }, { tasks: [{ id: 't1', text: 'Fix', done: r.chance(0.5) }] }, { label: 'green' }, { speaker: 'Ana' }, { note: null, tasks: null }, { reverse: r.chance(0.5) }]) } }
    }
    case 'freeze': {
      const c = anyClip((x) => x.kind === 'video')
      return c ? { name: 'clip.freeze', input: { id: c.id, frame: r.int(c.start, clipEnd(c)), duration: r.int(1, 60) } } : null
    }
    case 'paste': {
      const c = r.pick(clips)
      return { name: 'clip.paste', input: { clips: [JSON.parse(JSON.stringify(c))], at: frame(), mode: r.pick(['free', 'overwrite', 'insert']) } }
    }
    case 'nest': {
      // Rarely: a nested timeline takes its clips out of this one for good.
      if (!r.chance(0.15)) return null
      const c = anyClip((x) => x.kind === 'video')
      return c ? { name: 'clip.nest', input: { ids: [c.id] } } : null
    }
    case 'dropMedia': {
      // Rarely: media leaves the project (its clips go, and takes of it), then comes back empty-handed.
      if (!r.chance(0.2)) return null
      const id = r.pick(['v3', 'a2'])
      return p.assets[id] ? { name: 'asset.remove', input: { ids: [id] } } : { name: 'asset.add', input: { asset: asset(id, (MEDIA as Record<string, number>)[id], id === 'a2' ? 'audio' : 'video') } }
    }
    case 'attributes': {
      const from = r.pick(clips)
      return { name: 'clip.copyAttributes', input: { fromId: from.id, ids: ids(2), include: r.pick([['speed'], ['transform', 'color'], ['audio', 'effects'], ['speed', 'animation']]) } }
    }
    case 'roll': {
      const c = r.pick(clips)
      return { name: 'clip.roll', input: { id: c.id, frame: c.start + r.int(-20, 20) } }
    }
  }
}

function run(seed: number, steps: number) {
  const r = rng(seed)
  setUp()
  const log: string[] = []
  for (let step = 0; step < steps; step++) {
    // Now and then, step back and forth through history instead of editing.
    if (r.chance(0.06) && useEditor.getState().past.length) {
      const n = r.int(1, 3)
      for (let i = 0; i < n; i++) useEditor.getState().undo()
      const back = r.int(0, n)
      for (let i = 0; i < back; i++) useEditor.getState().redo()
      const bad = problems(getProject())
      if (bad.length) throw new Error(`seed ${seed}, step ${step}: after undo ×${n}, redo ×${back}:\n  ${bad.join('\n  ')}\n${log.slice(-6).join('\n')}`)
      continue
    }
    const edit = someEdit(r)
    if (!edit || !(edit.name in commands)) continue
    const before = getProject()
    const on = typeof edit.ripples === 'object' ? edit.ripples.on : undefined
    const left = still(before, on)
    const kept = locked(before)
    const res = dispatch(edit.name, edit.input as CommandInput<CommandName>)
    const said = `${edit.name} ${JSON.stringify(edit.input)}${res.ok ? '' : ` → refused: ${res.error}`}`
    log.push(said)
    const after = getProject()
    const fail = (what: string) => new Error(`seed ${seed}, step ${step}: ${what}\n  after ${said}\n  earlier:\n    ${log.slice(-7, -1).join('\n    ')}`)
    if (!res.ok) {
      if (after !== before) throw fail('a refused command changed the project')
      continue
    }
    const bad = problems(after)
    if (bad.length) throw fail(bad.join('\n  '))
    if (edit.ripples && still(after, on) !== left) throw fail('a ripple moved clips on a track that doesn’t follow ripples')
    if (!REACHES_LOCKED.has(edit.name) && locked({ ...after, tracks: after.tracks.filter((t) => before.tracks.some((b) => b.id === t.id && b.locked)) }) !== kept) throw fail('an edit changed a locked track')
    if (after !== before) {
      useEditor.getState().undo()
      if (canonical(getProject()) !== canonical(before)) throw fail('undo didn’t put back what was there')
      useEditor.getState().redo()
      if (canonical(getProject()) !== canonical(after)) throw fail('redo didn’t do the same again')
    }
  }
}

// FUZZ_RUNS=300 (and FUZZ_STEPS) make a long hunt of it; the default is a quick check on every test run.
const RUNS = Number(process.env.FUZZ_RUNS) || 12
const STEPS = Number(process.env.FUZZ_STEPS) || 260

describe('whatever is done to a timeline', () => {
  for (let seed = 1; seed <= RUNS; seed++) {
    it(`it stays a sound timeline, and undo puts everything back (run ${seed})`, () => {
      expect(() => run(seed * 7919, STEPS)).not.toThrow()
    })
  }
})
