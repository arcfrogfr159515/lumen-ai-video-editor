/**
 * Edit macros: a run of edits made by hand on one clip, written down so it can
 * be done again on others. Recording turns each command into a step that no
 * longer says "that clip, that frame" but "the clip, this far from its start";
 * replaying turns it back into a command for whichever clip it is run on.
 */
import type { CommandName } from './commands'
import { clipEnd } from './ops'
import type { Clip, Frame, Project } from './types'

/** A value in a step's input that stands for something of the clip the macro runs on. */
export type Placeholder =
  /** The clip itself. */
  | { $clip: true }
  /** A frame on the timeline, counted from the clip's start or its end. */
  | { $frame: { from: 'start' | 'end'; offset: number } }
  /** A track, counted from the clip's own (0), in tracks up (negative) or down. */
  | { $track: number }
  /** Something an earlier step answered with (a new clip's id, say): the step, and where in its answer. */
  | { $result: { step: number; path: string } }
  /** One of the clip's effects, by kind (and which of several). */
  | { $effect: { kind: string; index: number } }
  /** One of the clip's masks, by position. */
  | { $mask: number }

export interface MacroStep {
  command: CommandName
  /** The command's input, with placeholders where it named the clip, a frame, or something made on the way. */
  input: unknown
  /** What the step did, in words (its history label when it was recorded). */
  title: string
}

export interface Macro {
  id: string
  name: string
  steps: MacroStep[]
  createdAt: number
}

/** Commands a macro can hold: edits to clips and to the time around them. */
const RECORDABLE = /^(clip|effect|mask|keyframe|take)\.|^(marker\.add|timeline\.(setRange|removeRange|liftRange)|multicam\.switch)$/

export const recordable = (command: string) => RECORDABLE.test(command)

/** The fields of each command's input that are frames on the timeline (dotted paths; `*` is every item of an array). */
const FRAME_FIELDS: Partial<Record<CommandName, string[]>> = {
  'clip.split': ['frame'],
  'clip.trim': ['frame'],
  'clip.roll': ['frame'],
  'clip.freeze': ['frame'],
  'clip.move': ['moves.*.start'],
  'clip.paste': ['at'],
  'marker.add': ['frame'],
  'timeline.setRange': ['range.in', 'range.out'],
  'timeline.removeRange': ['start', 'end'],
  'timeline.liftRange': ['start', 'end'],
  'multicam.switch': ['frame'],
}

const isPlain = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Every string in a command's answer, with where it is: "", "0", "clipId", "clipIds.1"… */
function leaves(value: unknown, path = ''): [string, string][] {
  if (typeof value === 'string') return [[path, value]]
  if (Array.isArray(value)) return value.flatMap((v, i) => leaves(v, path ? `${path}.${i}` : String(i)))
  if (isPlain(value)) return Object.entries(value).flatMap(([k, v]) => leaves(v, path ? `${path}.${k}` : k))
  return []
}

const at = (value: unknown, path: string): unknown => (path === '' ? value : path.split('.').reduce<unknown>((v, key) => (v === null || v === undefined ? undefined : (v as Record<string, unknown>)[key]), value))

/** Matches a path against a pattern with `*` for any one segment. */
const matches = (path: string, pattern: string) => {
  const a = path.split('.')
  const b = pattern.split('.')
  return a.length === b.length && b.every((seg, i) => seg === '*' || seg === a[i])
}

export interface RecordContext {
  /** The clip the edits are being made on. */
  clipId: string
  /** What the steps recorded so far answered with. */
  results: unknown[]
}

/**
 * Writes a command down as a step: wherever its input names the clip being
 * edited, a frame of the timeline, a track, one of the clip's effects or
 * masks, or something an earlier step made, it says so in terms that hold for
 * any clip. `before` is the project just before the command ran.
 */
export function generalize(command: CommandName, input: unknown, before: Project, ctx: RecordContext): unknown {
  const subject = before.clips[ctx.clipId] as Clip | undefined
  const made = new Map<string, Placeholder>()
  ctx.results.forEach((result, step) => {
    for (const [path, value] of leaves(result)) if (!made.has(value)) made.set(value, { $result: { step, path } })
  })
  const frames = FRAME_FIELDS[command] ?? []
  const trackIndex = (id: string) => before.tracks.findIndex((t) => t.id === id)

  const walk = (value: unknown, path: string, parent?: Record<string, unknown>): unknown => {
    if (typeof value === 'string') {
      if (value === ctx.clipId) return { $clip: true } satisfies Placeholder
      const from = made.get(value)
      if (from) return from
      const key = path.split('.').pop()
      if (subject && key === 'trackId' && trackIndex(value) >= 0 && trackIndex(subject.trackId) >= 0) return { $track: trackIndex(value) - trackIndex(subject.trackId) } satisfies Placeholder
      if (subject && key === 'effectId') {
        const effect = subject.effects.find((e) => e.id === value)
        if (effect) return { $effect: { kind: effect.kind, index: subject.effects.filter((e) => e.kind === effect.kind).indexOf(effect) } } satisfies Placeholder
      }
      if (subject && key === 'maskId') {
        const i = subject.masks?.findIndex((m) => m.id === value) ?? -1
        if (i >= 0) return { $mask: i } satisfies Placeholder
      }
      return value
    }
    if (typeof value === 'number' && subject && frames.some((f) => matches(path, f))) {
      // Trims are about the edge being moved; everything else is nearer one end of the clip or the other.
      const edge = command === 'clip.trim' ? (parent?.edge === 'end' ? 'end' : 'start') : Math.abs(value - clipEnd(subject)) < Math.abs(value - subject.start) ? 'end' : 'start'
      return { $frame: { from: edge, offset: value - (edge === 'end' ? clipEnd(subject) : subject.start) } } satisfies Placeholder
    }
    if (Array.isArray(value)) {
      const out = value.map((v, i) => walk(v, path ? `${path}.${i}` : String(i)))
      // Several clips were edited at once: on replay the step is done to one clip at a time.
      const seen = new Set<string>()
      return out.filter((v) => {
        if (!isPlain(v) || !('$clip' in v)) return true
        if (seen.has('$clip')) return false
        seen.add('$clip')
        return true
      })
    }
    if (isPlain(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v, path ? `${path}.${k}` : k, value)]))
    return value
  }
  return walk(input, '')
}

/** Every number in an input, with where it is. */
function numbers(value: unknown, path = ''): [string, number][] {
  if (typeof value === 'number') return [[path, value]]
  if (Array.isArray(value)) return value.flatMap((v, i) => numbers(v, path ? `${path}.${i}` : String(i)))
  if (isPlain(value)) return Object.entries(value).flatMap(([k, v]) => numbers(v, path ? `${path}.${k}` : k))
  return []
}

/**
 * Whether a command had to do with the clip being edited: it names the clip
 * (or something a step made from it), or — a marker, a marked stretch — it is
 * about a frame the clip covers.
 */
export function touches(command: CommandName, input: unknown, before: Project, ctx: RecordContext): boolean {
  const known = new Set([ctx.clipId, ...ctx.results.flatMap((r) => leaves(r).map(([, v]) => v))])
  if (leaves(input).some(([, v]) => known.has(v))) return true
  const subject = before.clips[ctx.clipId]
  const fields = FRAME_FIELDS[command]
  if (!subject || !fields) return false
  return numbers(input).some(([path, frame]) => fields.some((f) => matches(path, f)) && frame >= subject.start && frame <= clipEnd(subject))
}

export class MacroError extends Error {}

export interface ReplayContext {
  clipId: string
  results: unknown[]
}

/**
 * Turns a step back into a command's input for one clip, on the project as it
 * is now. Throws a MacroError when the clip hasn't what the step needs (an
 * effect it adjusts, a track that far away).
 */
export function instantiate(step: MacroStep, project: Project, ctx: ReplayContext): unknown {
  const clip = project.clips[ctx.clipId] as Clip | undefined
  const need = () => {
    if (!clip) throw new MacroError('the clip is gone by this step')
    return clip
  }
  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(walk)
    if (!isPlain(value)) return value
    if ('$clip' in value) return ctx.clipId
    if ('$frame' in value) {
      const { from, offset } = (value as Extract<Placeholder, { $frame: unknown }>).$frame
      const c = need()
      return Math.max(0, Math.round((from === 'end' ? clipEnd(c) : c.start) + offset)) as Frame
    }
    if ('$track' in value) {
      const c = need()
      const index = project.tracks.findIndex((t) => t.id === c.trackId) + (value as { $track: number }).$track
      const track = project.tracks[index]
      if (!track) throw new MacroError('there is no track that far from the clip’s')
      return track.id
    }
    if ('$result' in value) {
      const { step: n, path } = (value as Extract<Placeholder, { $result: unknown }>).$result
      const found = at(ctx.results[n], path)
      if (typeof found !== 'string') throw new MacroError(`step ${n + 1} made nothing for this step to work on`)
      return found
    }
    if ('$effect' in value) {
      const { kind, index } = (value as Extract<Placeholder, { $effect: unknown }>).$effect
      const effect = need().effects.filter((e) => e.kind === kind)[index]
      if (!effect) throw new MacroError(`the clip has no ${kind} effect to change`)
      return effect.id
    }
    if ('$mask' in value) {
      const mask = need().masks?.[(value as { $mask: number }).$mask]
      if (!mask) throw new MacroError('the clip has no such mask')
      return mask.id
    }
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v)]))
  }
  return walk(step.input)
}

// ─── Files ───────────────────────────────────────────────────────────────

const FORMAT = 'lumen-macros'

/** Macros as a file's text. */
export const exportMacros = (macros: readonly Macro[]) => JSON.stringify({ format: FORMAT, version: 1, macros }, null, 2) + '\n'

/** Reads macros from a file's text: every one that is well formed. Throws when it isn't a macro file at all. */
export function importMacros(text: string): Macro[] {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new MacroError('That file isn’t a macro file (it isn’t JSON).')
  }
  if (!isPlain(data) || data.format !== FORMAT || !Array.isArray(data.macros)) throw new MacroError('That file isn’t a macro file.')
  return data.macros.filter(
    (m): m is Macro =>
      isPlain(m) &&
      typeof m.id === 'string' &&
      typeof m.name === 'string' &&
      Array.isArray(m.steps) &&
      m.steps.every((s) => isPlain(s) && typeof s.command === 'string' && recordable(s.command) && typeof s.title === 'string' && 'input' in s),
  )
}
