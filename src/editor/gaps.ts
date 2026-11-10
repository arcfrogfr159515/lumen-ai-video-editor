/**
 * Gaps and flash frames: finding the holes an edit left behind — stretches
 * where nothing plays at all, slivers of empty space between two clips, clips
 * only a frame or two long — and closing them without knocking anything out
 * of sync.
 */
import { clipEnd, clipsOnTrack, dropLoneGroups, isMagnetic, isRippleLocked, mediaEdgeLimits, overlaps, removeRange, setClipEnd, setClipStart } from './ops'
import type { Clip, Frame, Project, Track } from './types'

/** Empty space or a clip this short is a flash: a mistake nobody means to make. */
export const FLASH_FRAMES = 3

export interface TrackGap {
  trackId: string
  start: Frame
  end: Frame
  frames: number
  /** A sliver between two clips (or before the first), short enough to flash by. */
  flash: boolean
  /** Before the first clip on the track. */
  leading: boolean
}

export interface Hole {
  start: Frame
  end: Frame
  frames: number
}

export interface FlashClip {
  clipId: string
  trackId: string
  name: string
  start: Frame
  frames: number
}

export interface GapReport {
  /** Stretches where no track has anything: black and silent in the film. */
  holes: Hole[]
  /** Empty space between clips, track by track (the main track closes its own, so it has none). */
  gaps: TrackGap[]
  /** Clips that last only a few frames. */
  flashClips: FlashClip[]
}

const fixable = (t: Track) => !t.locked

/** Captions can be a word long — a few frames — and mean it. */
const flashes = (t: Track) => t.role !== 'captions'

/** What is empty and what flashes, on the tracks that can be edited. */
export function findGaps(project: Pick<Project, 'clips' | 'tracks'>, flashFrames = FLASH_FRAMES): GapReport {
  const p = project as Project
  const gaps: TrackGap[] = []
  const flashClips: FlashClip[] = []
  for (const track of project.tracks) {
    if (!fixable(track)) continue
    let cursor = 0
    let first = true
    for (const c of clipsOnTrack(p, track.id)) {
      if (c.start > cursor && !isMagnetic(track)) {
        const frames = c.start - cursor
        // Space before the first clip is where the track comes in; only a sliver of it is a mistake.
        if (!first || frames <= flashFrames) gaps.push({ trackId: track.id, start: cursor, end: c.start, frames, flash: frames <= flashFrames, leading: first })
      }
      if (c.duration <= flashFrames && flashes(track)) flashClips.push({ clipId: c.id, trackId: track.id, name: c.name, start: c.start, frames: c.duration })
      cursor = Math.max(cursor, clipEnd(c))
      first = false
    }
  }
  return { holes: findHoles(project), gaps: gaps.sort((a, b) => a.start - b.start), flashClips: flashClips.sort((a, b) => a.start - b.start) }
}

/** Stretches before the end of the timeline that no clip on any track covers. */
export function findHoles(project: Pick<Project, 'clips'>): Hole[] {
  const spans = Object.values(project.clips)
    .map((c) => [c.start, clipEnd(c)] as [number, number])
    .sort((a, b) => a[0] - b[0])
  const holes: Hole[] = []
  let cursor = 0
  for (const [a, b] of spans) {
    if (a > cursor) holes.push({ start: cursor, end: a, frames: a - cursor })
    cursor = Math.max(cursor, b)
  }
  return holes
}

export interface CloseGapsOptions {
  /** Take out the stretches where nothing plays (every track that follows ripples closes up). */
  holes?: boolean
  /** Fill slivers of empty space by letting a neighbour run a few frames longer. */
  flashGaps?: boolean
  /** Remove clips only a few frames long, their neighbours taking up the space. */
  flashClips?: boolean
  /** How short counts as a flash. */
  flashFrames?: number
  /** Tracks on which every gap is closed by moving the later clips up — which changes what they line up with. */
  trackIds?: readonly string[]
}

export interface CloseGapsResult {
  holesClosed: number
  /** Frames the timeline got shorter by. */
  framesRemoved: number
  flashGapsFilled: number
  flashClipsRemoved: number
  trackGapsClosed: number
  /** Slivers left as they were: neither neighbour has footage to cover them. */
  left: number
}

/**
 * Fills [a, b) on a track by running the clip before it later or the clip after
 * it earlier — whichever has the footage (stills, titles and freezes always do).
 */
function cover(p: Project, before: Clip | undefined, after: Clip | undefined, a: Frame, b: Frame) {
  if (before && clipEnd(before) === a && mediaEdgeLimits(p, before)[1] >= b) {
    setClipEnd(before, b)
    return true
  }
  if (after && after.start === b && mediaEdgeLimits(p, after)[0] <= a) {
    setClipStart(after, a)
    // What it faded or cut in from sits a few frames earlier now; nothing else changes.
    return true
  }
  return false
}

/**
 * Moves a clip, and the clips linked to it on other tracks with it, so picture
 * and sound stay together. False (and nothing moves) when a linked clip can't
 * follow: it is on the main track or a locked one, or would land on a neighbour.
 */
function shiftWithGroup(p: Project, clip: Clip, delta: number) {
  const mates = clip.groupId ? Object.values(p.clips).filter((c) => c.groupId === clip.groupId && c.id !== clip.id) : []
  for (const m of mates) {
    const track = p.tracks.find((t) => t.id === m.trackId)
    if (!track || !fixable(track) || isMagnetic(track) || isRippleLocked(track)) return false
    const start = m.start + delta
    if (start < 0) return false
    const blocked = clipsOnTrack(p, m.trackId).some((o) => o.id !== m.id && o.id !== clip.id && !mates.includes(o) && overlaps(start, start + m.duration, o.start, clipEnd(o)))
    if (blocked) return false
  }
  clip.start += delta
  for (const m of mates) m.start += delta
  return true
}

/** Cleans a timeline up. Works on a draft; returns what it did. */
export function closeGaps(p: Project, opts: CloseGapsOptions = {}): CloseGapsResult {
  const flashFrames = opts.flashFrames ?? FLASH_FRAMES
  const out: CloseGapsResult = { holesClosed: 0, framesRemoved: 0, flashGapsFilled: 0, flashClipsRemoved: 0, trackGapsClosed: 0, left: 0 }
  const editable = p.tracks.filter(fixable)

  if (opts.flashClips !== false) {
    for (const track of editable) {
      if (!flashes(track)) continue
      const groups: string[] = []
      for (const c of clipsOnTrack(p, track.id)) {
        if (c.duration > flashFrames || !p.clips[c.id]) continue
        const list = clipsOnTrack(p, track.id)
        const i = list.findIndex((x) => x.id === c.id)
        const before = list[i - 1]
        const after = list[i + 1]
        const [a, b] = [c.start, clipEnd(c)]
        if (c.groupId) groups.push(c.groupId)
        delete p.clips[c.id]
        // A neighbour takes up the frames, so nothing after it moves — on the main track too.
        if (!cover(p, before, after, a, b) && isMagnetic(track)) out.framesRemoved += b - a
        out.flashClipsRemoved++
      }
      dropLoneGroups(p, groups)
    }
  }

  if (opts.flashGaps !== false) {
    for (const track of editable) {
      if (isMagnetic(track)) continue
      const list = clipsOnTrack(p, track.id)
      let cursor = 0
      for (let i = 0; i < list.length; i++) {
        const c = list[i]
        const frames = c.start - cursor
        if (frames > 0 && frames <= flashFrames) {
          if (cover(p, list[i - 1], c, cursor, c.start)) out.flashGapsFilled++
          else out.left++
        }
        cursor = Math.max(cursor, clipEnd(c))
      }
    }
  }

  if (opts.holes !== false) {
    // Last first, so the earlier ones are still where they were found.
    for (const hole of findHoles(p).reverse()) {
      removeRange(p, hole.start, hole.end)
      out.holesClosed++
      out.framesRemoved += hole.frames
    }
  }

  for (const trackId of opts.trackIds ?? []) {
    const track = p.tracks.find((t) => t.id === trackId)
    if (!track || !fixable(track) || isMagnetic(track) || isRippleLocked(track)) continue
    let cursor = 0
    let first = true
    for (const c of clipsOnTrack(p, trackId)) {
      // Where the track comes in is left alone: only the space between its clips closes.
      if (!first && c.start > cursor && shiftWithGroup(p, c, cursor - c.start)) out.trackGapsClosed++
      cursor = Math.max(cursor, clipEnd(c))
      first = false
    }
  }
  return out
}

/** What a clean-up did, in a sentence. */
export function describeCleanup(r: CloseGapsResult, fps: number) {
  const parts: string[] = []
  const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`
  if (r.holesClosed) parts.push(`closed ${n(r.holesClosed, 'hole', 'holes')}`)
  if (r.flashGapsFilled) parts.push(`filled ${n(r.flashGapsFilled, 'sliver', 'slivers')}`)
  if (r.flashClipsRemoved) parts.push(`removed ${n(r.flashClipsRemoved, 'flash frame', 'flash frames')}`)
  if (r.trackGapsClosed) parts.push(`closed ${n(r.trackGapsClosed, 'gap', 'gaps')} on the chosen tracks`)
  if (!parts.length) return r.left ? `Nothing could be closed: ${n(r.left, 'sliver has', 'slivers have')} no footage either side to cover ${r.left === 1 ? 'it' : 'them'}.` : 'Nothing to clean up.'
  const text = parts.join(', ')
  const shorter = r.framesRemoved ? ` The timeline is ${(r.framesRemoved / fps).toFixed(r.framesRemoved < fps ? 2 : 1)} s shorter.` : ''
  const left = r.left ? ` ${n(r.left, 'sliver was', 'slivers were')} left: no footage either side to cover ${r.left === 1 ? 'it' : 'them'}.` : ''
  return `${text[0].toUpperCase()}${text.slice(1)}.${shorter}${left}`
}

export const cleanupDidNothing = (r: CloseGapsResult) => !r.holesClosed && !r.flashGapsFilled && !r.flashClipsRemoved && !r.trackGapsClosed

/** Whether a report has anything a one-click clean-up would fix. */
export const hasProblems = (r: GapReport) => r.holes.length > 0 || r.flashClips.length > 0 || r.gaps.some((g) => g.flash)
