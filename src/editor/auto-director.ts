/**
 * The auto-director: cuts a multicam clip between its cameras the way a
 * vision mixer would — to whoever is speaking, a beat ahead of them, never
 * too soon after the last cut, out to the wide shot when everyone talks or
 * nobody does, and away for a reaction when one shot has run long.
 *
 * It works from one signal per camera: how much is going on there, moment by
 * moment. That is the camera's own microphone (each mic hears its own speaker
 * loudest), and, when the footage has been watched, how much the picture moves.
 */
import { PEAKS_PER_SECOND } from './defaults'
import { clipEnd } from './ops'
import { angleTracks } from './sequences'
import type { Clip, Frame, Project, Sequence } from './types'

export interface AngleSignal {
  /** Loudness of the camera's own sound, one value per step (any scale: each camera is judged against itself). */
  level: number[]
  /** How much the picture moves, one value per step — optional. */
  motion?: number[]
}

export interface DirectorOptions {
  /** Seconds each value of the signals covers. */
  step: number
  /** The shortest a shot may be, in seconds (default 2.5). */
  minShot?: number
  /** A shot longer than this gets a cutaway, in seconds (default 14). */
  maxShot?: number
  /** The camera that shows everyone (its index), for when several speak or nobody does. Null or missing: there is none. */
  wide?: number | null
  /** Cut this long before the speaker starts, in seconds (default 0.25): the eye wants to be there first. */
  lead?: number
  /** Cut away to a listener when one shot has run long (default true). */
  reactions?: boolean
  /** How much the picture's movement counts beside the sound, 0..1 (default 0.35; only when motion is given). */
  motionWeight?: number
}

export interface DirectorCut {
  /** Seconds from the start of the signals. */
  at: number
  /** The camera to cut to (its index). */
  angle: number
  why: 'opening' | 'speaker' | 'everyone' | 'quiet' | 'reaction'
}

const percentile = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * p)))] ?? 0

/** What is loud for a signal: the level it reaches in its loudest twentieth. */
export const loudLevel = (values: readonly number[]) => percentile([...values].sort((a, b) => a - b), 0.95)

/** A signal whose loudest moments are this small a share of the loudest signal's has nothing of its own: it only hears the others, or the room. */
const FAINT = 0.08

/**
 * A signal judged against itself: 0 at its own floor (room tone, a still
 * picture), 1 at what is loud for it, smoothed over `window` steps so a
 * consonant or a cough isn't a change of speaker. `reference` is what is loud
 * for the loudest of the signals it is compared with: one that never comes near
 * it is all zeros, however much its own noise wanders.
 */
export function normalizeSignal(values: readonly number[], window = 3, reference = 0): number[] {
  if (!values.length) return []
  const sorted = [...values].sort((a, b) => a - b)
  const floor = percentile(sorted, 0.1)
  const loud = percentile(sorted, 0.95)
  const span = loud - floor
  // A signal that never changes says nothing; nor does one that is only noise beside the others.
  if (!(span > 1e-6) || loud < reference * FAINT) return values.map(() => 0)
  const scaled = values.map((v) => Math.min(1.5, Math.max(0, (v - floor) / span)))
  const half = Math.max(0, Math.floor(window / 2))
  return scaled.map((_, i) => {
    let sum = 0
    let n = 0
    for (let k = Math.max(0, i - half); k <= Math.min(scaled.length - 1, i + half); k++) {
      sum += scaled[k]
      n++
    }
    return sum / n
  })
}

/** Above this, someone is talking (in a signal normalized against itself). */
const SPEAKING = 0.3
/** A second voice within this share of the loudest counts as talking too. */
const TOGETHER = 0.78

/**
 * Plans the cuts. Returns them in order, starting with the opening shot at 0;
 * consecutive cuts are always to different cameras and at least `minShot` apart.
 */
export function directCuts(angles: readonly AngleSignal[], opts: DirectorOptions): DirectorCut[] {
  const n = angles.length
  const steps = Math.max(0, ...angles.map((a) => a.level.length))
  if (!n || !steps) return []
  const { step } = opts
  const minShot = Math.max(step, opts.minShot ?? 2.5)
  const maxShot = Math.max(minShot * 2, opts.maxShot ?? 14)
  const lead = Math.max(0, opts.lead ?? 0.25)
  const wide = opts.wide !== null && opts.wide !== undefined && opts.wide >= 0 && opts.wide < n ? opts.wide : null
  const weight = opts.motionWeight ?? 0.35
  const smooth = Math.max(1, Math.round(0.45 / step))
  const loudest = Math.max(0, ...angles.map((a) => loudLevel(a.level)))
  const liveliest = Math.max(0, ...angles.map((a) => (a.motion?.length ? loudLevel(a.motion) : 0)))
  const act = angles.map((a) => {
    const level = normalizeSignal(a.level, smooth, loudest)
    const motion = a.motion?.length ? normalizeSignal(a.motion, smooth, liveliest) : null
    return Array.from({ length: steps }, (_, i) => {
      const l = level[i] ?? 0
      // Sound decides; movement tips the balance — and decides alone for a camera with no sound of its own.
      return motion ? (level.some((v) => v > 0) ? l + weight * (motion[i] ?? 0) : (motion[i] ?? 0)) : l
    })
  })

  /** Who the picture should be on at a step: a camera, or -1 for "nobody in particular". */
  const wanted = (i: number): { angle: number; why: DirectorCut['why'] } => {
    let top = -1
    let second = -1
    for (let a = 0; a < n; a++) {
      if (a === wide) continue
      if (top < 0 || act[a][i] > act[top][i]) {
        second = top
        top = a
      } else if (second < 0 || act[a][i] > act[second][i]) second = a
    }
    if (top < 0) return { angle: wide ?? 0, why: 'quiet' }
    if (act[top][i] < SPEAKING) return { angle: wide ?? -1, why: 'quiet' }
    if (second >= 0 && act[second][i] >= SPEAKING && act[second][i] >= act[top][i] * TOGETHER) return wide !== null ? { angle: wide, why: 'everyone' } : { angle: top, why: 'speaker' }
    return { angle: top, why: 'speaker' }
  }

  // The opening shot: the wide if there is one and nobody starts talking at once, else whoever speaks first.
  const first = (() => {
    for (let i = 0; i < Math.min(steps, Math.round(1 / step)); i++) {
      const w = wanted(i)
      if (w.why === 'speaker') return w.angle
    }
    if (wide !== null) return wide
    for (let i = 0; i < steps; i++) {
      const w = wanted(i)
      if (w.angle >= 0) return w.angle
    }
    return 0
  })()

  const cuts: DirectorCut[] = [{ at: 0, angle: first, why: 'opening' }]
  let current = first
  let since = 0
  /** How long the picture has wanted to be somewhere else, and where. */
  let pending = { angle: -1, why: 'speaker' as DirectorCut['why'], from: 0 }
  /** While set, the shot is a cutaway: it goes back to who it left once it has run its length. */
  let reaction: { back: number; until: number } | null = null
  const hold = Math.max(1, Math.round(0.4 / step))
  const quietHold = Math.max(hold, Math.round(1.6 / step))

  const cut = (at: number, angle: number, why: DirectorCut['why']) => {
    const last = cuts[cuts.length - 1]
    const t = Math.max(last.at + minShot * (why === 'reaction' || reaction ? 0.6 : 1), at)
    if (angle === current || t >= steps * step) return false
    cuts.push({ at: Math.round(t * 1000) / 1000, angle, why })
    current = angle
    since = t
    return true
  }

  for (let i = 0; i < steps; i++) {
    const t = i * step
    const w = wanted(i)
    if (reaction) {
      // Back to the speaker when the cutaway has had its moment — or at once if someone else starts.
      if (t >= reaction.until || (w.why === 'speaker' && w.angle !== reaction.back && w.angle !== current)) {
        const to = w.why === 'speaker' ? w.angle : reaction.back
        reaction = null
        cut(t, to, 'speaker')
        pending = { angle: -1, why: 'speaker', from: i }
      }
      continue
    }
    if (w.angle >= 0 && w.angle !== current) {
      if (pending.angle !== w.angle) pending = { angle: w.angle, why: w.why, from: i }
      const waited = i - pending.from + 1
      const needs = w.why === 'speaker' ? hold : quietHold
      if (waited >= needs && t - since >= minShot - lead) {
        // The cut goes where the change began, a beat early.
        if (cut(Math.max(since + minShot, pending.from * step - lead), w.angle, w.why)) pending = { angle: -1, why: 'speaker', from: i }
        continue
      }
    } else pending = { angle: -1, why: 'speaker', from: i }

    // One shot has run long: look at someone listening, then come back.
    if (opts.reactions !== false && n > 1 && t - since >= maxShot && w.angle === current && w.why === 'speaker') {
      let listener = wide !== null && wide !== current ? wide : -1
      if (listener < 0) {
        // The camera that has had the most to say lately, other than the speaker's.
        let best = -Infinity
        const from = Math.max(0, i - Math.round(20 / step))
        for (let a = 0; a < n; a++) {
          if (a === current) continue
          let sum = 0
          for (let k = from; k < i; k++) sum += act[a][k]
          if (sum > best) {
            best = sum
            listener = a
          }
        }
      }
      if (listener >= 0) {
        const back = current
        const length = Math.max(minShot * 0.6, Math.min(3, minShot))
        if (cut(t, listener, 'reaction')) reaction = { back, until: t + length }
      }
    }
  }
  return cuts
}

// ─── Reading a multicam timeline ─────────────────────────────────────────

/**
 * Each camera's sound level over a multicam timeline, from the waveforms its
 * media already has: one value per `step` seconds, per angle, in angle order.
 * A camera with no waveform (no sound, or not analysed yet) is all zeros.
 */
export function angleLevels(project: Pick<Project, 'assets'>, seq: Sequence, step: number): { levels: number[][]; seconds: number; missing: number[] } {
  const fps = seq.settings.fps
  const angles = angleTracks(seq)
  const end = Math.max(0, ...Object.values(seq.clips).map(clipEnd))
  const seconds = end / fps
  const steps = Math.ceil(seconds / step)
  const missing: number[] = []
  const levels = angles.map((track, index) => {
    const clips = Object.values(seq.clips).filter((c) => c.trackId === track.id && c.assetId)
    const out = new Array<number>(steps).fill(0)
    let heard = false
    for (const clip of clips) {
      const peaks = project.assets[clip.assetId!]?.peaks
      if (!peaks?.length) continue
      heard = true
      const from = Math.max(0, Math.floor(clip.start / fps / step))
      const to = Math.min(steps, Math.ceil(clipEnd(clip) / fps / step))
      for (let i = from; i < to; i++) {
        // The loudest moment of the step, read where the clip's footage is at that time.
        const s0 = (clip.inPoint + (i * step * fps - clip.start) * clip.speed) / fps
        const a = Math.max(0, Math.floor(s0 * PEAKS_PER_SECOND))
        const b = Math.min(peaks.length, Math.max(a + 1, Math.ceil((s0 + step * clip.speed) * PEAKS_PER_SECOND)))
        let peak = 0
        for (let k = a; k < b; k++) peak = Math.max(peak, peaks[k] ?? 0)
        out[i] = Math.max(out[i], peak)
      }
    }
    if (!heard) missing.push(index)
    return out
  })
  return { levels, seconds, missing }
}

export interface PlannedSwitch {
  /** Timeline frame of the cut. */
  frame: Frame
  /** 1 = the first camera, as multicam.switch counts them. */
  angle: number
  why: DirectorCut['why']
}

/**
 * The plan as cuts on the timeline, for one multicam clip: the part of the plan
 * the clip plays, in timeline frames. The first one sits on the clip's first
 * frame and says which camera the clip starts on.
 */
export function switchesFor(project: Pick<Project, 'settings'>, clip: Clip, cuts: readonly DirectorCut[]): PlannedSwitch[] {
  const fps = project.settings.fps
  // A nested timeline's time, in this timeline's frames, is the clip's in-point plus how far in it is (times its speed).
  const toLocal = (seconds: number) => (seconds * fps - clip.inPoint) / clip.speed
  const out: PlannedSwitch[] = []
  let opening: DirectorCut | undefined
  for (const c of cuts) {
    const local = Math.round(toLocal(c.at))
    if (local <= 0) opening = c
    else if (local < clip.duration) out.push({ frame: clip.start + local, angle: c.angle + 1, why: c.why })
  }
  if (opening) out.unshift({ frame: clip.start, angle: opening.angle + 1, why: opening.why })
  // Two cuts on one frame (rounding): the later one is the one that shows.
  return out.filter((s, i) => i === out.length - 1 || out[i + 1].frame !== s.frame)
}

/** What a plan amounts to, for a preview: how many cuts, the average shot, and how much of the time each camera gets. */
export function planSummary(cuts: readonly DirectorCut[], seconds: number, angles: number) {
  const share = new Array<number>(angles).fill(0)
  cuts.forEach((c, i) => {
    const end = cuts[i + 1]?.at ?? seconds
    share[c.angle] += Math.max(0, end - c.at)
  })
  return { cuts: Math.max(0, cuts.length - 1), averageShot: cuts.length ? seconds / cuts.length : 0, share: share.map((s) => (seconds > 0 ? s / seconds : 0)) }
}
