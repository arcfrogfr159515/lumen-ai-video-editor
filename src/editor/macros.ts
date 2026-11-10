/**
 * Edit macros: a run of edits made by hand on one clip, written down so it can
 * be done again on others. Recording turns each command into a step that no
 * longer says "that clip, that frame" but "the clip, this far from its start";
 * replaying turns it back into a command for whichever clip it is run on.
 */
import type { CommandName } from './commands'
import { clipEnd } from './ops'
import type { Clip, Frame, Project } from './types'

/**
 * A clip a step is about: the one the macro runs on, one an earlier step
 * answered with (the second half of a split, a copy), or one an earlier step
 * left behind without saying so (what remains after a stretch is lifted out
 * of a clip, or after a freeze frame is put in the middle of one).
 */
export type ClipRef = { $clip: true } | { $result: { step: number; path: string } } | { $made: { step: number; index: number } }

/** A value in a step's input that stands for something of the clip the macro runs on. */
export type Placeholder =
  /** The clip itself. */
  | { $clip: true }
  /** A frame on the timeline, counted from the start or the end of a clip: the clip itself, unless `of` names another. */
  | { $frame: { from: 'start' | 'end'; offset: number; of?: ClipRef } }
  /** A track, counted from a clip's own (0), in tracks up (negative) or down: the clip itself, unless `of` names another. */
  | { $track: number; of?: ClipRef }
  /** Something an earlier step answered with (a new clip's id, say): the step, and where in its answer. */
  | { $result: { step: number; path: string } }
  /** A clip an earlier step made: the step, and which of the clips it made (see `madeBy`). */
  | { $made: { step: number; index: number } }
  /** An effect of the clip the step is about, by kind (and which of several). */
  | { $effect: { kind: string; index: number } }
  /** A mask of the clip the step is about, by position. */
  | { $mask: number }
  /** An alternate take of the clip the step is about, by position in its list. */
  | { $take: number }
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
  /** The frame rate it was recorded at. Run on a timeline at another rate, its lengths are scaled: half a second stays half a second. */
  fps?: number
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

/** The fields that are lengths in frames rather than places on the timeline: scaled with the frame rate, like the distances from a clip's edges. */
const LENGTH_FIELDS: Partial<Record<CommandName, string[]>> = {
  'clip.slip': ['frames'],
  'clip.slide': ['frames'],
  'clip.freeze': ['duration'],
  'clip.update': ['patch.audio.fadeIn', 'patch.audio.fadeOut', 'patch.animation.in.duration', 'patch.animation.out.duration'],
  'clip.setTransition': ['transition.duration'],
  'clip.animate': ['at', 'duration'],
  'clip.batch': ['fadeIn', 'fadeOut'],
  'keyframe.set': ['frame'],
  'keyframe.remove': ['frame'],
  'keyframe.move': ['from', 'to'],
  'take.add': ['inPoint'],
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
  /** The clips each of those steps made (see `madeBy`). */
  made?: string[][]
}

/**
 * The clips an edit made, in an order that is the same whenever the same edit
 * is made: by track, top first, then by where they start.
 */
export function madeBy(before: Project, after: Project): string[] {
  if (before.clips === after.clips) return []
  const order = new Map(after.tracks.map((t, i) => [t.id, i]))
  return Object.values(after.clips)
    .filter((c) => !before.clips[c.id])
    .sort((a, b) => (order.get(a.trackId) ?? 0) - (order.get(b.trackId) ?? 0) || a.start - b.start)
    .map((c) => c.id)
}

/** The clips a recording knows: the one being edited and those its steps made, each as a step would name it. */
function knownClips(before: Project, ctx: RecordContext): Map<string, ClipRef> {
  const known = new Map<string, ClipRef>([[ctx.clipId, { $clip: true }]])
  ctx.results.forEach((result, step) => {
    for (const [path, value] of leaves(result)) if (!known.has(value) && before.clips[value]) known.set(value, { $result: { step, path } })
  })
  ctx.made?.forEach((ids, step) => ids.forEach((id, index) => void (!known.has(id) && before.clips[id] && known.set(id, { $made: { step, index } }))))
  return known
}

/** The clip an input (or part of one) is addressed to: its clipId, its id, or the first of its ids. */
function addressed(value: Record<string, unknown>, isClip: (id: unknown) => boolean): unknown {
  if (isClip(value.clipId)) return value.clipId
  if (isClip(value.id)) return value.id
  if (Array.isArray(value.ids) && isClip(value.ids[0])) return value.ids[0]
  return undefined
}

/**
 * Writes a command down as a step: wherever its input names the clip being
 * edited, a frame of the timeline, a track, an effect, a mask or a take of a
 * clip, or something an earlier step made, it says so in terms that hold for
 * any clip. Frames and tracks are counted from the clip the command is
 * addressed to — the clip being edited, or a piece an earlier step made of
 * it. `before` is the project just before the command ran.
 */
export function generalize(command: CommandName, input: unknown, before: Project, ctx: RecordContext): unknown {
  const known = knownClips(before, ctx)
  const made = new Map<string, Placeholder>()
  ctx.results.forEach((result, step) => {
    for (const [path, value] of leaves(result)) if (!made.has(value)) made.set(value, { $result: { step, path } })
  })
  const frames = FRAME_FIELDS[command] ?? []
  const trackIndex = (id: string) => before.tracks.findIndex((t) => t.id === id)
  const isClip = (id: unknown) => typeof id === 'string' && Boolean(before.clips[id])
  /** The clip a frame or a track is counted from: the one addressed if the recording knows it, else the clip being edited, else whatever is left of it. */
  const reference = (owner: string | undefined): { clip: Clip; of?: ClipRef } | null => {
    const pick = (id: string | undefined) => {
      const ref = id ? known.get(id) : undefined
      const clip = id ? (before.clips[id] as Clip | undefined) : undefined
      return ref && clip ? { clip, ...('$clip' in ref ? {} : { of: ref }) } : null
    }
    return pick(owner) ?? pick(ctx.clipId) ?? pick([...known.keys()].find((id) => before.clips[id]))
  }

  const walk = (value: unknown, path: string, parent: Record<string, unknown> | undefined, owner: string | undefined): unknown => {
    if (typeof value === 'string') {
      if (value === ctx.clipId) return { $clip: true } satisfies Placeholder
      const from = made.get(value) ?? known.get(value)
      if (from) return from
      const key = path.split('.').pop()
      const own = (owner ? before.clips[owner] : undefined) ?? before.clips[ctx.clipId]
      if (key === 'trackId' && trackIndex(value) >= 0) {
        const ref = reference(owner)
        if (ref && trackIndex(ref.clip.trackId) >= 0) return { $track: trackIndex(value) - trackIndex(ref.clip.trackId), ...(ref.of ? { of: ref.of } : {}) } satisfies Placeholder
      }
      if (own && key === 'effectId') {
        const effect = own.effects.find((e) => e.id === value)
        if (effect) return { $effect: { kind: effect.kind, index: own.effects.filter((e) => e.kind === effect.kind).indexOf(effect) } } satisfies Placeholder
      }
      if (own && key === 'maskId') {
        const i = own.masks?.findIndex((m) => m.id === value) ?? -1
        if (i >= 0) return { $mask: i } satisfies Placeholder
      }
      if (own && key === 'takeId') {
        const i = own.takes?.findIndex((t) => t.id === value) ?? -1
        if (i >= 0) return { $take: i } satisfies Placeholder
      }
      return value
    }
    if (typeof value === 'number' && frames.some((f) => matches(path, f))) {
      const ref = reference(owner)
      if (!ref) return value
      // Trims are about the edge being moved; everything else is nearer one end of the clip or the other.
      const edge = command === 'clip.trim' ? (parent?.edge === 'end' ? 'end' : 'start') : Math.abs(value - clipEnd(ref.clip)) < Math.abs(value - ref.clip.start) ? 'end' : 'start'
      return { $frame: { from: edge, offset: value - (edge === 'end' ? clipEnd(ref.clip) : ref.clip.start), ...(ref.of ? { of: ref.of } : {}) } } satisfies Placeholder
    }
    if (Array.isArray(value)) {
      const out = value.map((v, i) => walk(v, path ? `${path}.${i}` : String(i), parent, owner))
      // Several clips were edited at once: on replay the step is done to one clip at a time.
      const seen = new Set<string>()
      return out.filter((v) => {
        if (!isPlain(v) || !('$clip' in v)) return true
        if (seen.has('$clip')) return false
        seen.add('$clip')
        return true
      })
    }
    if (isPlain(value)) {
      const to = addressed(value, isClip)
      const own = typeof to === 'string' ? to : owner
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v, path ? `${path}.${k}` : k, value, own)]))
    }
    return value
  }
  return walk(input, '', undefined, undefined)
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
 * about a frame the clip, or a piece made of it, covers.
 */
export function touches(command: CommandName, input: unknown, before: Project, ctx: RecordContext): boolean {
  const known = knownClips(before, ctx)
  const named = new Set([...known.keys(), ...ctx.results.flatMap((r) => leaves(r).map(([, v]) => v))])
  if (leaves(input).some(([, v]) => named.has(v))) return true
  const fields = FRAME_FIELDS[command]
  if (!fields) return false
  const spans = [...known.keys()].map((id) => before.clips[id]).filter(Boolean)
  return numbers(input).some(([path, frame]) => fields.some((f) => matches(path, f)) && spans.some((c) => frame >= c.start && frame <= clipEnd(c)))
}

export class MacroError extends Error {}

export interface ReplayContext {
  clipId: string
  results: unknown[]
  /** The clips each step run so far made (see `madeBy`). */
  made?: string[][]
}

/**
 * Turns a step back into a command's input for one clip, on the project as it
 * is now. Throws a MacroError when the clip hasn't what the step needs (an
 * effect it adjusts, a track that far away). `scale` is this timeline's frame
 * rate over the one the macro was recorded at.
 */
export function instantiate(step: MacroStep, project: Project, ctx: ReplayContext, scale = 1): unknown {
  const lengths = scale === 1 ? [] : (LENGTH_FIELDS[step.command] ?? [])
  const result = (value: Extract<Placeholder, { $result: unknown }>) => {
    const { step: n, path } = value.$result
    const found = at(ctx.results[n], path)
    if (typeof found !== 'string') throw new MacroError(`step ${n + 1} made nothing for this step to work on`)
    return found
  }
  const piece = (value: Extract<Placeholder, { $made: unknown }>) => {
    const { step: n, index } = value.$made
    const found = ctx.made?.[n]?.[index]
    if (!found) throw new MacroError(`step ${n + 1} didn’t leave the piece this step works on`)
    return found
  }
  /** The clip a reference names (the clip the macro runs on when there is none), as it is now. */
  const clipOf = (ref: ClipRef | undefined): Clip => {
    const id = !ref || '$clip' in ref ? ctx.clipId : '$made' in ref ? piece(ref) : result(ref)
    const clip = project.clips[id] as Clip | undefined
    if (!clip) throw new MacroError(ref && !('$clip' in ref) ? 'the piece an earlier step made is gone by this step' : 'the clip is gone by this step')
    return clip
  }
  const isRef = (v: unknown): v is ClipRef => isPlain(v) && ('$clip' in v || '$result' in v || '$made' in v)
  /** `owner`: the clip the surrounding input is addressed to — whose effects, masks and takes it means. */
  const walk = (value: unknown, owner: ClipRef | undefined, path: string): unknown => {
    if (Array.isArray(value)) return value.map((v, i) => walk(v, owner, path ? `${path}.${i}` : String(i)))
    if (typeof value === 'number' && lengths.some((f) => matches(path, f))) return Math.round(value * scale)
    if (!isPlain(value)) return value
    if ('$clip' in value) return ctx.clipId
    if ('$frame' in value) {
      const { from, offset, of } = (value as Extract<Placeholder, { $frame: unknown }>).$frame
      const c = clipOf(of)
      return Math.max(0, Math.round((from === 'end' ? clipEnd(c) : c.start) + offset * scale)) as Frame
    }
    if ('$track' in value) {
      const { $track: by, of } = value as Extract<Placeholder, { $track: unknown }>
      const c = clipOf(of)
      const track = project.tracks[project.tracks.findIndex((t) => t.id === c.trackId) + by]
      if (!track) throw new MacroError('there is no track that far from the clip’s')
      return track.id
    }
    if ('$result' in value) return result(value as Extract<Placeholder, { $result: unknown }>)
    if ('$made' in value) return piece(value as Extract<Placeholder, { $made: unknown }>)
    if ('$effect' in value) {
      const { kind, index } = (value as Extract<Placeholder, { $effect: unknown }>).$effect
      const effect = clipOf(owner).effects.filter((e) => e.kind === kind)[index]
      if (!effect) throw new MacroError(`the clip has no ${kind} effect to change`)
      return effect.id
    }
    if ('$mask' in value) {
      const mask = clipOf(owner).masks?.[(value as { $mask: number }).$mask]
      if (!mask) throw new MacroError('the clip has no such mask')
      return mask.id
    }
    if ('$take' in value) {
      const take = clipOf(owner).takes?.[(value as { $take: number }).$take]
      if (!take) throw new MacroError('the clip has no such take')
      return take.id
    }
    const to = [value.clipId, value.id, Array.isArray(value.ids) ? value.ids[0] : undefined].find(isRef)
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v, to ?? owner, path ? `${path}.${k}` : k)]))
  }
  return walk(step.input, undefined, '')
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
      (m.fps === undefined || (typeof m.fps === 'number' && m.fps > 0)) &&
      Array.isArray(m.steps) &&
      m.steps.every((s) => isPlain(s) && typeof s.command === 'string' && recordable(s.command) && typeof s.title === 'string' && 'input' in s),
  )
}
