/**
 * Trim mode: a cut picked out to be trimmed from the keyboard, while the
 * timeline plays. This is what a cut is, which sides of it can move, how far,
 * and the command that puts it somewhere.
 */
import { clamp } from '@/lib/math'
import type { CommandInput, CommandName } from './commands'
import { adjacentAfter, adjacentBefore, clipEnd, isMagneticTrack, mediaEdgeLimits, rollBounds } from './ops'
import type { Clip, Frame, Project } from './types'

/**
 * roll: the cut moves, the clip before it growing as the one after shrinks.
 * out: the end of the clip before the cut moves, and everything after follows.
 * in: the clip after the cut starts on a different frame of its footage, and everything after it follows.
 */
export type TrimSide = 'roll' | 'out' | 'in'

export const TRIM_SIDES: { id: TrimSide; label: string; hint: string }[] = [
  { id: 'roll', label: 'Roll', hint: 'Moves the cut: one clip gets longer, the other shorter' },
  { id: 'out', label: 'Out', hint: 'Where the clip before the cut ends — everything after it follows' },
  { id: 'in', label: 'In', hint: 'The frame the clip after the cut starts on — everything after it follows' },
]

/** A place on a track where a clip ends, another begins, or both. */
export interface TrimCut {
  trackId: string
  frame: Frame
  /** The clip that ends at the cut. */
  left?: string
  /** The clip that starts at the cut. */
  right?: string
}

/** The sides of a cut that can be trimmed: rolling needs a clip either side. */
export function trimSides(cut: TrimCut): TrimSide[] {
  if (cut.left && cut.right) return ['roll', 'out', 'in']
  return cut.left ? ['out'] : cut.right ? ['in'] : []
}

/** The cut at a clip's start or end, with the clip that touches it on the other side. */
export function cutAt(project: Project, clip: Clip, edge: 'start' | 'end'): TrimCut {
  if (edge === 'start') return { trackId: clip.trackId, frame: clip.start, right: clip.id, ...(adjacentBefore(project, clip) ? { left: adjacentBefore(project, clip)!.id } : {}) }
  return { trackId: clip.trackId, frame: clipEnd(clip), left: clip.id, ...(adjacentAfter(project, clip) ? { right: adjacentAfter(project, clip)!.id } : {}) }
}

/**
 * The cut to trim: the one nearest `frame`, on unlocked tracks. A cut on a
 * selected clip wins over one that is merely nearer; among equals the main
 * track wins, then the track higher up. The very start of the timeline is no cut.
 */
export function nearestCut(project: Project, frame: Frame, selection: readonly string[] = []): TrimCut | null {
  const locked = new Set(project.tracks.filter((t) => t.locked).map((t) => t.id))
  const order = new Map(project.tracks.map((t, i) => [t.id, i]))
  const main = new Set(project.tracks.filter((t) => t.role === 'main').map((t) => t.id))
  const chosen = new Set(selection)
  let best: { cut: TrimCut; score: number[] } | null = null
  // Scores compare like words: the first place they differ decides.
  const better = (a: number[], b: number[]) => {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i]
    return false
  }
  const seen = new Set<string>()
  for (const clip of Object.values(project.clips)) {
    if (locked.has(clip.trackId)) continue
    for (const edge of ['start', 'end'] as const) {
      const cut = cutAt(project, clip, edge)
      if (cut.frame <= 0) continue
      const key = `${cut.trackId}:${cut.frame}`
      if (seen.has(key)) continue
      seen.add(key)
      const picked = (cut.left && chosen.has(cut.left)) || (cut.right && chosen.has(cut.right)) ? 0 : 1
      const score = [picked, Math.abs(cut.frame - frame), main.has(cut.trackId) ? 0 : 1, order.get(cut.trackId) ?? 0]
      if (!best || better(score, best.score)) best = { cut, score }
    }
  }
  return best?.cut ?? null
}

/**
 * The frames a side of a cut can be taken to: [earliest, latest]. For `in` the
 * frame says which of the clip's frames becomes its first — the one showing
 * there now, or, before the cut, one from the footage ahead of its in-point.
 */
export function trimLimits(project: Project, cut: TrimCut, side: TrimSide): [Frame, Frame] {
  const left = cut.left ? project.clips[cut.left] : undefined
  const right = cut.right ? project.clips[cut.right] : undefined
  if (side === 'roll') {
    if (!left || !right) return [cut.frame, cut.frame]
    return rollBounds(project, left, right)
  }
  if (side === 'out') {
    if (!left) return [cut.frame, cut.frame]
    const [, mediaMax] = mediaEdgeLimits(project, left)
    return [left.start + 1, mediaMax]
  }
  if (!right) return [cut.frame, cut.frame]
  const [mediaMin] = mediaEdgeLimits(project, right)
  return [Math.max(0, mediaMin), clipEnd(right) - 1]
}

export interface TrimStep<N extends CommandName = CommandName> {
  command: N
  input: CommandInput<N>
  /** Where the cut (or, for `in`, the clip's new first frame as it stood before) ends up. */
  frame: Frame
}

/** The command that takes a side of a cut to `frame`, kept within what the footage allows. Null when nothing would change. */
export function trimStep(project: Project, cut: TrimCut, side: TrimSide, frame: Frame): TrimStep | null {
  const [lo, hi] = trimLimits(project, cut, side)
  const target = clamp(Math.round(frame), lo, hi)
  if (target === cut.frame) return null
  if (side === 'roll') return { command: 'clip.roll', input: { id: cut.right!, frame: target }, frame: target }
  // On the main track every trim ripples; elsewhere it has to be asked for.
  const ripple = !isMagneticTrack(project, cut.trackId)
  if (side === 'out') return { command: 'clip.trim', input: { id: cut.left!, edge: 'end', frame: target, ripple }, frame: target }
  return { command: 'clip.trim', input: { id: cut.right!, edge: 'start', frame: target, ripple }, frame: target }
}

/** The same cut after an edit: its clips are where they are now (null if they are gone or no longer meet). */
export function refreshCut(project: Project, cut: TrimCut): TrimCut | null {
  const left = cut.left ? project.clips[cut.left] : undefined
  const right = cut.right ? project.clips[cut.right] : undefined
  if (cut.left && !left) return null
  if (cut.right && !right) return null
  if (left && right && clipEnd(left) !== right.start) return null
  const frame = right ? right.start : left ? clipEnd(left) : cut.frame
  return { ...cut, trackId: (right ?? left)!.trackId, frame }
}
