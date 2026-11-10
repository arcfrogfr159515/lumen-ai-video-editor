/**
 * A macro recorded on one clip and run on its twin — the same footage, the
 * same length, elsewhere on the timeline — must leave the twin exactly as the
 * recording left the first: whatever the edits were, and in whatever order.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { CommandInput, CommandName } from './commands'
import { cancelRecording, runMacro, startRecording, stopRecording, useMacros } from './macro-store'
import { clipEnd } from './ops'
import { dispatch, getProject } from './store'
import { MEDIA, problems, rng, setUp, type Rng } from './test-invariants'
import type { Clip, Project } from './types'

// FUZZ_RUNS=300 makes a long hunt of it.
const RUNS = Number(process.env.FUZZ_RUNS) || 12

/** Where the twin sits, in frames after the first clip: far enough that nothing done to one reaches the other. */
const APART = 5000

const settle = () => new Promise<void>((resolve) => queueMicrotask(resolve))

beforeEach(() => {
  cancelRecording()
  useMacros.setState({ macros: [], lastId: null })
})

/** One half of the timeline as a recording should leave it: its clips and markers, without ids, measured from `origin`. */
function picture(p: Project, origin: number, twin: boolean, split: number) {
  const mine = (frame: number) => (twin ? frame >= split : frame < split)
  const tracks = new Map(p.tracks.map((t, i) => [t.id, i]))
  const groups = new Map<string, number>()
  const clips = Object.values(p.clips)
    .filter((c) => mine(c.start))
    .sort((a, b) => a.start - b.start || tracks.get(a.trackId)! - tracks.get(b.trackId)!)
    .map((c) => {
      const { id: _id, trackId, start, groupId, takes, takeId, effects, masks, name: _name, ...rest } = c as Clip & { masks?: { id: string }[] }
      if (groupId && !groups.has(groupId)) groups.set(groupId, groups.size)
      return {
        ...rest,
        track: tracks.get(trackId),
        start: start - origin,
        ...(groupId ? { group: groups.get(groupId) } : {}),
        effects: effects.map(({ id: _e, ...e }) => e),
        ...(masks ? { masks: masks.map(({ id: _m, ...m }) => m) } : {}),
        ...(takes ? { takes: takes.map(({ id: _t, ...t }) => t), showing: takes.findIndex((t) => t.id === takeId) } : {}),
      }
    })
  const markers = p.markers.filter((m) => mine(m.frame)).map(({ id: _id, frame, label: _label, ...m }) => ({ ...m, frame: frame - origin }))
  return { clips, markers }
}

/** A random edit to the clip being recorded on, or to something an earlier edit made of it. */
function editOf(r: Rng, firstId: string): { name: CommandName; input: unknown } | null {
  const p = getProject()
  const first = p.clips[firstId]
  // Everything on this side of the timeline came from the first clip.
  const mine = Object.values(p.clips).filter((c) => c.start < APART / 2)
  if (!mine.length) return null
  const c = first && r.chance(0.6) ? first : r.pick(mine)
  const inside = () => r.int(c.start, clipEnd(c))
  const media = c.kind === 'video' || c.kind === 'audio'
  switch (r.pick(['grade', 'transform', 'sound', 'trim', 'trim', 'split', 'split', 'effect', 'effectAmount', 'keyframe', 'slip', 'freeze', 'speed', 'ramp', 'take', 'takeSwitch', 'marker', 'move', 'duplicate', 'batch', 'note', 'animate', 'range', 'lift'] as const)) {
    case 'grade':
      return { name: 'clip.update', input: { ids: [c.id], patch: { color: { [r.pick(['exposure', 'contrast', 'saturation'])]: r.int(-50, 50) } } } }
    case 'transform':
      return { name: 'clip.update', input: { ids: [c.id], patch: { transform: { scale: r.pick([0.5, 1.2, 2]), x: r.int(-200, 200) } } } }
    case 'sound':
      return { name: 'clip.update', input: { ids: [c.id], patch: { audio: { volume: r.int(-12, 6), fadeIn: r.int(0, 10) } } } }
    case 'trim':
      return { name: 'clip.trim', input: { id: c.id, edge: r.pick(['start', 'end']), frame: r.int(c.start - 20, clipEnd(c) + 20), ripple: false } }
    case 'split':
      return { name: 'clip.split', input: { frame: inside(), ids: [c.id] } }
    case 'effect':
      return { name: 'effect.add', input: { ids: [c.id], kind: r.pick(['blur', 'glow', 'vignette', 'grain']), amount: r.int(10, 90) } }
    case 'effectAmount':
      return c.effects.length ? { name: 'effect.update', input: { clipId: c.id, effectId: r.pick(c.effects).id, patch: { amount: r.int(0, 100) } } } : null
    case 'keyframe':
      return { name: 'keyframe.set', input: { clipId: c.id, prop: r.pick(['x', 'scale', 'opacity', 'volume']), frame: r.int(0, c.duration), value: r.pick([0, 0.5, 1]) } }
    case 'slip':
      return media ? { name: 'clip.slip', input: { id: c.id, frames: r.int(-40, 40) } } : null
    case 'freeze':
      return c.kind === 'video' ? { name: 'clip.freeze', input: { id: c.id, frame: inside(), duration: r.int(5, 40) } } : null
    case 'speed':
      return media ? { name: 'clip.update', input: { ids: [c.id], patch: { speed: r.pick([0.5, 1, 2]) } } } : null
    case 'ramp':
      return media ? { name: 'clip.setSpeedRamp', input: { id: c.id, points: [{ at: 0, speed: 1 }, { at: 1, speed: r.pick([0.5, 2]), easing: 'linear' }] } } : null
    case 'take':
      return media ? { name: 'take.add', input: { clipId: c.id, assetId: r.pick(['v2', 'v3']), inPoint: r.int(0, 200), show: r.chance(0.6) } } : null
    case 'takeSwitch':
      return c.takes?.length ? { name: 'take.switch', input: { clipId: c.id, step: r.pick([1, -1]) } } : null
    case 'marker':
      return { name: 'marker.add', input: { frame: inside(), kind: r.pick(['todo', 'comment', undefined]) } }
    case 'move': {
      // (Not onto the main track: its clips close up from the start, so the two clips would end up side by side.)
      const tracks = p.tracks.filter((t) => t.kind === 'video' && !t.role)
      return { name: 'clip.move', input: { moves: [{ id: c.id, start: Math.max(0, c.start + r.int(-30, 60)), trackId: r.pick(tracks).id }], mode: 'free' } }
    }
    case 'duplicate':
      return { name: 'clip.duplicate', input: { ids: [c.id] } }
    case 'batch':
      return { name: 'clip.batch', input: { ids: [c.id], volume: { mode: 'offset', value: r.int(-6, 6) }, ...(r.chance(0.4) ? { speed: { mode: 'scale', value: r.pick([0.5, 2]) } } : {}) } }
    case 'note':
      return { name: 'clip.update', input: { ids: [c.id], patch: { note: 'Look again', label: r.pick(['red', 'blue']) } } }
    case 'animate':
      return { name: 'clip.animate', input: { clipId: c.id, preset: r.pick(['push-in', 'fade-in', 'pop-in', 'punch']) } }
    case 'range':
      return { name: 'timeline.setRange', input: { range: { in: c.start, out: clipEnd(c) } } }
    case 'lift': {
      const a = inside()
      return { name: 'timeline.liftRange', input: { start: a, end: a + r.int(1, 30) } }
    }
  }
}

describe('a macro run on the twin of the clip it was recorded on', () => {
  for (let seed = 1; seed <= RUNS; seed++) {
    it(`leaves the twin as the recording left the first (run ${seed})`, async () => {
      const r = rng(seed * 15485863)
      setUp()
      const overlay = getProject().tracks.find((t) => t.name === 'Overlay')!.id
      const at = 600
      const inPoint = r.int(100, 600)
      const duration = r.int(60, 400)
      expect(inPoint + duration).toBeLessThan(MEDIA.v1 * 30)
      const make = (start: number) => {
        const res = dispatch('clip.add', { trackId: overlay, kind: 'video', assetId: 'v1', start, duration, inPoint })
        if (!res.ok) throw new Error(res.error)
        return res.result as string
      }
      const first = make(at)
      const twin = make(at + APART)

      startRecording(first)
      const log: string[] = []
      const edits = r.int(1, Number(process.env.FUZZ_STEPS) || 14)
      for (let i = 0; i < edits; i++) {
        const edit = editOf(r, first)
        if (!edit) continue
        const res = dispatch(edit.name, edit.input as CommandInput<CommandName>)
        log.push(`${edit.name} ${JSON.stringify(edit.input)}${res.ok ? '' : ` → refused: ${res.error}`}`)
        await settle()
      }
      const skipped = useMacros.getState().recording!.skipped
      const macro = stopRecording('Twin')
      const told = `seed ${seed}\n  ${log.join('\n  ')}\n  left out: ${skipped.join('; ') || 'nothing'}`
      if (!macro) return
      // Everything done was done to the first clip or to what came of it: nothing is left out.
      expect(skipped, told).toEqual([])

      // Recording may have pushed the twin along its track (a freeze frame makes room for itself): it is measured
      // from where it stands when the macro starts on it.
      const origin = getProject().clips[twin].start
      const run = runMacro(macro, [twin])
      expect(run, told).toEqual({ done: 1, failed: [] })
      expect(problems(getProject()), told).toEqual([])
      const here = picture(getProject(), at, false, origin - APART / 2)
      const there = picture(getProject(), origin, true, origin - APART / 2)
      const brief = (side: typeof here) => side.clips.map((c) => `t${c.track} ${c.start}+${c.duration} in ${c.inPoint} ×${c.speed}${'takes' in c ? ` takes ${(c.takes as unknown[]).length}/${c.showing}` : ''}`).join(' | ')
      expect(there, `${told}\n  steps: ${JSON.stringify(macro.steps.map((s) => [s.command, s.input]))}\n  first: ${brief(here)}\n  twin:  ${brief(there)}`).toEqual(here)
    })
  }
})
