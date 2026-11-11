/**
 * Three- and four-point editing. An edit puts a stretch of source on a
 * stretch of timeline, which takes four numbers — source in and out, timeline
 * in and out — but any three settle the fourth, and fewer still fall back on
 * the playhead and the ends of the source. This works out what an edit means
 * from whichever points are marked.
 */
import { clamp } from '@/lib/math'
import { MAX_SPEED, MIN_SPEED } from './timing'
import type { Frame } from './types'
import { tt } from '@/lib/i18n'

export interface EditPoints {
  /** Marks in the source, in project frames (out is exclusive). */
  sourceIn?: Frame
  sourceOut?: Frame
  /** Marks on the timeline (out is exclusive). */
  timelineIn?: Frame
  timelineOut?: Frame
  /** Where the edit goes when the timeline has no marks. */
  playhead: Frame
  /** How long the source is, in project frames (Infinity for stills). */
  sourceLength: number
}

/**
 * When all four points are marked and the two stretches differ in length:
 * `fit` changes the speed so the source fills the timeline stretch exactly,
 * `source` takes the source as marked (the timeline out is ignored),
 * `timeline` fills the timeline stretch from the source in (the source out is ignored).
 */
export type FourPointMode = 'fit' | 'source' | 'timeline'

export interface ResolvedEdit {
  /** Where the clip starts on the timeline. */
  start: Frame
  duration: Frame
  /** Where in the source it starts. */
  inPoint: Frame
  speed: number
  /** How many of the four points were marked. */
  points: number
  /** Placed from its end backwards (an out point with no in point to go with it). */
  backtimed: boolean
  /** Frames the edit falls short of what was marked, because the source ran out. */
  short: number
  /** Frames cut off the head because a backtimed edit would have begun before the timeline does. */
  headLost: number
}

/** A still with nothing marked plays this long, in seconds. */
export const STILL_SECONDS = 5

export function resolveEdit(pts: EditPoints, fps: number, mode: FourPointMode = 'source'): ResolvedEdit {
  const length = pts.sourceLength
  const finite = Number.isFinite(length)
  // Marks outside the source, or the wrong way round, are read as unmarked.
  const sIn = pts.sourceIn !== undefined ? clamp(Math.round(pts.sourceIn), 0, finite ? Math.max(0, length - 1) : Infinity) : undefined
  let sOut = pts.sourceOut !== undefined ? clamp(Math.round(pts.sourceOut), 1, finite ? length : Infinity) : undefined
  if (sIn !== undefined && sOut !== undefined && sOut <= sIn) sOut = undefined
  const tIn = pts.timelineIn !== undefined ? Math.max(0, Math.round(pts.timelineIn)) : undefined
  // (An out point at the very start of the timeline has nothing before it to end: that is no mark either.)
  let tOut = pts.timelineOut !== undefined && Math.round(pts.timelineOut) > 0 ? Math.round(pts.timelineOut) : undefined
  if (tIn !== undefined && tOut !== undefined && tOut <= tIn) tOut = undefined
  const points = [sIn, sOut, tIn, tOut].filter((v) => v !== undefined).length

  const S = sIn !== undefined && sOut !== undefined ? sOut - sIn : undefined
  let T = tIn !== undefined && tOut !== undefined ? tOut - tIn : undefined
  let speed = 1

  if (S !== undefined && T !== undefined && S !== T) {
    if (mode === 'fit') speed = clamp(S / T, MIN_SPEED, MAX_SPEED)
    else if (mode === 'source') {
      tOut = undefined
      T = undefined
    } else sOut = undefined
  }

  // How long the edit wants to be: the timeline stretch when there is one, else the source stretch, else all the source there is.
  const sourceSpan = sIn !== undefined && sOut !== undefined ? sOut - sIn : undefined
  let want: number
  if (T !== undefined && (speed !== 1 || sourceSpan === undefined || sourceSpan === T)) want = T
  else if (sourceSpan !== undefined) want = sourceSpan
  else {
    const from = sIn ?? 0
    const to = sOut ?? length
    want = Number.isFinite(to) ? Math.max(1, to - from) : Math.round(STILL_SECONDS * fps)
  }

  // Where in the source it starts: at the in point, or far enough before the out point.
  let inPoint: number
  let backtimedSource = false
  if (sIn !== undefined) inPoint = sIn
  else if (sOut !== undefined) {
    inPoint = Math.max(0, sOut - Math.round(want * speed))
    // Only a length that came from the timeline makes this a backtimed edit; otherwise it is simply the source up to its out point.
    backtimedSource = T !== undefined
  } else inPoint = 0

  // The source may not have that much.
  let duration = want
  if (finite) {
    const end = sOut !== undefined && sIn === undefined ? sOut : length
    const available = Math.max(1, Math.floor((end - inPoint) / speed + 1e-6))
    duration = Math.min(want, available)
  }
  duration = Math.max(1, Math.round(duration))
  const short = Math.max(0, want - duration)
  let headLost = 0

  // Where on the timeline: at the in point, or ending at the out point, or at the playhead.
  // A backtimed edit lines the two out points up, even when the source came up short.
  let start: number
  let backtimed = backtimedSource
  if (tOut !== undefined && (backtimedSource || tIn === undefined)) {
    start = tOut - duration
    backtimed = true
    if (start < 0) {
      // It would begin before the timeline does: lose the head.
      headLost = Math.min(-start, duration - 1)
      inPoint += Math.round(headLost * speed)
      duration -= headLost
      start = 0
    }
  } else if (tIn !== undefined) start = tIn
  else start = Math.max(0, Math.round(pts.playhead))

  return { start, duration: Math.max(1, duration), inPoint: Math.max(0, inPoint), speed: Math.round(speed * 1000) / 1000, points, backtimed, short, headLost }
}

/** What an edit will do, in a line. */
export function describeEdit(edit: ResolvedEdit, fps: number, timecode: (frame: Frame) => string): string {
  const secs = (f: number) => `${(f / fps).toFixed(f % fps === 0 ? 0 : 2)} s`
  const kind = edit.points >= 4 ? tt('Four-point') : edit.points === 3 ? tt('Three-point') : edit.points === 0 ? tt('At the playhead') : `${edit.points}-point`
  const parts = [`${kind}: ${secs(edit.duration)} at ${timecode(edit.start)}`]
  if (edit.speed !== 1) parts.push(tt('fitted at {0}×', edit.speed))
  if (edit.backtimed) parts.push(tt('backtimed from the out point'))
  if (edit.short) parts.push(tt('{0} short — the source runs out', secs(edit.short)))
  if (edit.headLost) parts.push(tt('the first {0} fall before the start of the timeline', secs(edit.headLost)))
  return parts.join(' · ')
}
