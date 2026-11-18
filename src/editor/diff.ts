/**
 * Comparing two versions of a timeline. Not clip by clip — ids differ between
 * a timeline and its branch, and a cut that changes nothing isn't a
 * difference — but by what plays: each timeline is read as a run of
 * stretches of unbroken content, the two runs are lined up, and what is left
 * over are the stretches that differ, each with where it is in either version.
 *
 * A stretch that differs can then be taken from one version into the other.
 */
import { hashString } from '@/lib/math'
import { uid } from '@/lib/id'
import { createTrack } from './defaults'
import { ANIMATABLE, baseValue, propAt } from './keyframes'
import { followOffset } from './motion'
import { clipEnd, cloneClip, followsRipple, isMagnetic, removeRange, rippleInsert, setClipEnd, setClipStart, transitionLead } from './ops'
import { sourceFrameAt, speedAt } from './timing'
import type { Clip, Frame, Marker, Project, Sequence, Track } from './types'

/** A timeline as far as comparing goes: the open one or a stored one. */
export type Version = Pick<Sequence, 'tracks' | 'clips' | 'settings'> & { markers?: Marker[] }

export interface Hunk {
  /** Where the stretch is in the first version: [from, to). Empty when the second has something the first hasn't. */
  a: [Frame, Frame]
  /** Where it is in the second. Empty when the first has something the second hasn't. */
  b: [Frame, Frame]
  kind: 'changed' | 'added' | 'removed'
}

export interface TimelineDiff {
  hunks: Hunk[]
  /** Frames of the first version that differ, and of the second. */
  framesA: number
  framesB: number
  lengthA: Frame
  lengthB: Frame
}

// ─── What plays ──────────────────────────────────────────────────────────

/**
 * Everything about a clip that decides how it looks and sounds over the whole of it, apart from where it is and
 * which footage it shows. What acts on a few of its frames only — the animation it comes in or goes out with, the
 * fades of its sound — is `actingAt`'s: a cut leaves the way in on the first piece and the way out on the second,
 * so compared piece by piece a cut that changes nothing made each piece another clip.
 */
function lookOf(c: Clip): string {
  const { transform, color, blend, crop, text, speed, reverse, freeze, angle, keyframes } = c
  return String(
    hashString(
      JSON.stringify({
        kind: c.kind,
        transform,
        color,
        // The look it wears: kept beside the grade, not in it.
        look: c.look ?? null,
        blend,
        crop,
        text,
        speed,
        reverse,
        freeze,
        angle,
        // Ids are new on every copy: effects and masks are compared by what they are. (The path a mask follows is
        // counted in the clip's frames, which a cut starts again on its second piece: that is `movedAt`'s.)
        effects: c.effects.map(({ id: _id, ...e }) => e),
        masks: c.masks?.map(({ id: _id, follow: _follow, ...m }) => m),
        volume: c.audio.volume,
        enhance: c.audio.enhance,
        denoise: c.audio.denoise,
        detached: c.audio.detached,
        matte: c.matte,
        ramp: keyframes.speed,
        // Measured along the footage, not along the clip: a cut leaves it on both pieces as it was.
        steady: c.stabilize ?? null,
      }),
    ),
  )
}

/** Something that acts on the first frames of a clip, or on its last: what it is, and how many frames it lasts. */
interface Passing {
  what: string
  frames: Frame
}

interface Edges {
  head: Passing[]
  tail: Passing[]
}

/**
 * What a clip comes in with and what it goes out with, of its own: the animation of its picture and the fade of
 * its sound. A cut leaves the first on the first piece and the second on the second.
 */
function passing(c: Clip): Edges {
  const within = (frames: number | undefined) => Math.min(c.duration, Math.max(0, frames ?? 0))
  const list = (animation: 'in' | 'out', fade: number | undefined) => {
    const spec = c.animation?.[animation]
    const out: Passing[] = []
    if (spec && spec.preset !== 'none' && within(spec.duration)) out.push({ what: `${animation}:${spec.preset}/${spec.duration}`, frames: within(spec.duration) })
    // A fade of one frame is what taking a stretch out leaves at the join to keep the sound from clicking
    // (`removeRange`), not a fade anyone made: it isn't a difference.
    if (within(fade) > 1) out.push({ what: `fade ${animation}/${fade}`, frames: within(fade) })
    return out
  }
  return { head: list('in', c.audio?.fadeIn), tail: list('out', c.audio?.fadeOut) }
}

const passings = new WeakMap<Clip, Edges>()
const passingOf = (c: Clip) => passings.get(c) ?? (passings.set(c, passing(c)), passings.get(c)!)

const looks = new WeakMap<Clip, string>()
const look = (c: Clip) => looks.get(c) ?? (looks.set(c, lookOf(c)), looks.get(c)!)

/**
 * What acts at the edges of each clip of a track: what the clip comes in and goes out with of its own, and the
 * transition on the cut before it — which plays over its first frames, over the last frames of the clip it comes
 * from when it is set to begin before the cut, and not at all when no clip touches it there (`transitionAt`).
 * What it is on either clip names the clip on the other side of the cut too: a transition shows both.
 */
function edgesOf(clips: Clip[]): Map<Clip, Edges> {
  const edges = new Map<Clip, Edges>()
  clips.forEach((c, i) => {
    const own = passingOf(c)
    const prev = clips[i - 1]
    const next = clips[i + 1]
    const head = [...own.head]
    const tail = [...own.tail]
    const across = (tr: NonNullable<Clip['transitionIn']>, other: Clip, at: number) => `${tr.kind}/${tr.duration}/${tr.align ?? 'after'}:${mediaOf(other)}@${Math.round(sourceFrameAt(other, at) * 10) / 10}~${look(other)}`
    if (c.transitionIn && prev && clipEnd(prev) === c.start) {
      const frames = Math.min(c.duration, c.transitionIn.duration - transitionLead(c.transitionIn))
      if (frames > 0) head.push({ what: `from ${across(c.transitionIn, prev, prev.duration)}`, frames })
    }
    if (next?.transitionIn && next.start === clipEnd(c)) {
      const frames = Math.min(c.duration, transitionLead(next.transitionIn))
      if (frames > 0) tail.push({ what: `into ${across(next.transitionIn, next, 0)}`, frames })
    }
    edges.set(c, head.length === own.head.length && tail.length === own.tail.length ? own : { head, tail })
  })
  return edges
}

/**
 * What keyframes move: where the picture is, how large, how turned, how see-through, and how loud the sound. (The
 * speed's keyframes change which footage shows when, and are compared as that.) And what a tracked point moves:
 * the clip that follows it, or a mask of the clip. Compared by what they come to at each frame — not keyframe by
 * keyframe, or path by path: a cut gives each piece keyframes of its own, with one at the cut, and starts each
 * path again from the second piece's first frame; and keyframes that leave a value where it was change nothing.
 */
const MOVED = ANIMATABLE.filter((prop) => prop !== 'speed')
const moves = (c: Clip) => MOVED.some((prop) => c.keyframes[prop]?.length) || Boolean(c.follow) || Boolean(c.masks?.some((m) => m.follow))
const rounded = (v: number) => Math.round(v * 1e4) / 1e4
/** How far the clip, then each of its masks, has been carried by the point it follows: nowhere, without one. */
const carried = (c: Clip, local: number | null) => [c.follow, ...(c.masks ?? []).map((m) => m.follow)].flatMap((path) => (path && local !== null ? followOffset(path, local) : [0, 0])).map(rounded)
const stills = new WeakMap<Clip, string>()
/** Those values as they are without keyframes or anything to follow. */
const still = (c: Clip) => stills.get(c) ?? (stills.set(c, [...MOVED.map((prop) => rounded(baseValue(c, prop))), ...carried(c, null)].join(',')), stills.get(c)!)
/** And at a frame of the clip's own. */
const movedAt = (c: Clip, local: number) => (moves(c) ? [...MOVED.map((prop) => rounded(propAt(c, prop, local))), ...carried(c, local)].join(',') : still(c))

/** What a clip plays, without where: its footage (or timeline, or words). */
const mediaOf = (c: Clip) => c.assetId ?? (c.sequenceId ? `seq:${c.sequenceId}` : c.kind === 'text' ? `text:${hashString(c.text?.content ?? '')}` : c.kind)

interface Lane {
  /** What lines this track up with one in the other version. */
  key: string
  clips: Clip[]
  /** What acts at the edges of each of them. */
  edges: Map<Clip, Edges>
}

/** Whether a clip comes in with anything, and whether it goes out with anything. */
const comesIn = (lane: Lane, c: Clip) => lane.edges.get(c)!.head.length > 0
const goesOut = (lane: Lane, c: Clip) => lane.edges.get(c)!.tail.length > 0

/** What is acting at a frame of the clip's own ('' for nothing) — with `where`, also how far into it the frame is: counted from the clip's start for what it comes in with, from its end for what it goes out with. */
function acting(lane: Lane, c: Clip, local: number, where = false) {
  const { head, tail } = lane.edges.get(c)!
  let out = ''
  for (const p of head) if (local < p.frames) out += where ? `${p.what}@${local};` : `${p.what};`
  for (const p of tail) if (local >= c.duration - p.frames) out += where ? `${p.what}@${c.duration - local};` : `${p.what};`
  return out
}

/** What a clip shows at a frame of its own: the footage, how far into it, how it is dressed, what is acting on it there, and where its keyframes have it. */
const showing = (lane: Lane, c: Clip, local: number) =>
  `${mediaOf(c)}@${Math.round(sourceFrameAt(c, local) * 10) / 10}x${Math.round(speedAt(c, local) * 1000) / 1000}~${look(c)}~${acting(lane, c, local, true)}~${movedAt(c, local)}`

/**
 * The tracks of two versions paired up: a branch's tracks with the tracks they
 * began as, the rest by kind, role and name, then by order. A track only one
 * version has is paired with nothing.
 */
export function pairTracks(a: readonly Track[], b: readonly Track[]): [Track | undefined, Track | undefined][] {
  const pairs: [Track | undefined, Track | undefined][] = []
  const left = [...b]
  const take = (pred: (t: Track) => boolean) => {
    const i = left.findIndex(pred)
    return i >= 0 ? left.splice(i, 1)[0] : undefined
  }
  const root = (t: Track) => t.origin ?? t.id
  const unmatched: Track[] = []
  for (const t of a) {
    const hit = take((x) => root(x) === root(t))
    if (hit) pairs.push([t, hit])
    else unmatched.push(t)
  }
  for (const t of unmatched) {
    const hit = take((x) => x.kind === t.kind && x.role === t.role && x.name === t.name) ?? take((x) => x.kind === t.kind && x.role === t.role)
    pairs.push([t, hit])
  }
  for (const t of left) pairs.push([undefined, t])
  // In the first version's track order, with the second's extra tracks after.
  const order = new Map(a.map((t, i) => [t.id, i]))
  return pairs.sort((x, y) => (x[0] ? (order.get(x[0].id) ?? 0) : a.length) - (y[0] ? (order.get(y[0].id) ?? 0) : a.length))
}

function lanes(v: Version, tracks: (Track | undefined)[]): Lane[] {
  const by = new Map<string, Clip[]>()
  for (const c of Object.values(v.clips)) by.set(c.trackId, [...(by.get(c.trackId) ?? []), c])
  return tracks.map((t, i) => {
    const clips = t ? (by.get(t.id) ?? []).sort((x, y) => x.start - y.start) : []
    return { key: String(i), clips, edges: edgesOf(clips) }
  })
}

/** The clip on a track at a frame: the last one to start at or before it, if it runs that far. */
function clipAt(lane: Lane, frame: Frame) {
  const { clips } = lane
  let lo = 0
  let hi = clips.length - 1
  let hit = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (clips[mid].start <= frame) {
      hit = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return hit >= 0 && frame < clipEnd(clips[hit]) ? clips[hit] : undefined
}

/** What a version plays at a frame, across its tracks, as one comparable string. */
const contentAt = (ls: Lane[], frame: Frame) =>
  ls
    .map((lane) => {
      const c = clipAt(lane, frame)
      return c ? showing(lane, c, frame - c.start) : ''
    })
    .join('|')

interface Slice {
  start: Frame
  length: Frame
  /** What plays at its first frame, track by track — and, since content is unbroken within a slice, throughout. */
  token: string
}

/**
 * A version as a run of slices of unbroken content: it is cut wherever any
 * clip starts or ends, and stitched back wherever the footage simply carries
 * on across the cut (a blade through a clip changes nothing).
 */
function slices(ls: Lane[]): Slice[] {
  const edges = new Set<number>([0])
  let end = 0
  for (const lane of ls)
    for (const c of lane.clips) {
      edges.add(c.start)
      edges.add(clipEnd(c))
      // Where what it comes in with ends, and what it goes out with begins.
      for (const p of lane.edges.get(c)!.head) edges.add(c.start + p.frames)
      for (const p of lane.edges.get(c)!.tail) edges.add(clipEnd(c) - p.frames)
      end = Math.max(end, clipEnd(c))
    }
  const cuts = [...edges].filter((f) => f <= end).sort((x, y) => x - y)
  const out: Slice[] = []
  for (let i = 0; i < cuts.length - 1; i++) {
    const start = cuts[i]
    const length = cuts[i + 1] - start
    const prev = out[out.length - 1]
    // Unbroken across this edge: every track shows at the edge what it would have shown had the slice before simply run on.
    const carriesOn =
      prev !== undefined &&
      ls.every((lane) => {
        const before = clipAt(lane, start - 1)
        const after = clipAt(lane, start)
        if (!before || !after) return !before && !after
        // Within one clip, content is broken only where something stops or starts acting on it.
        if (before === after) return acting(lane, before, start - 1 - before.start) === acting(lane, after, start - after.start)
        // From one clip to the next: not when the first goes out with something, or the second comes in with something.
        if (goesOut(lane, before) || comesIn(lane, after)) return false
        if (mediaOf(before) !== mediaOf(after) || look(before) !== look(after) || before.keyframes.speed || after.keyframes.speed) return false
        return Math.abs(sourceFrameAt(before, start - before.start) - sourceFrameAt(after, 0)) < 0.51
      })
    if (carriesOn) prev.length += length
    else out.push({ start, length, token: contentAt(ls, start) })
  }
  // A slice is known by what plays at its first frame, which says nothing of where keyframes take the picture
  // after it: a slice in which they take it somewhere is known by that too.
  const moving = ls.map((lane) => lane.clips.filter(moves))
  if (moving.some((clips) => clips.length)) {
    for (const slice of out) {
      const motion = motionOver(moving, slice.start, slice.start + slice.length)
      if (motion) slice.token += `#${motion}`
    }
  }
  return out
}

/**
 * Where keyframes take the picture (and the sound) over a stretch, as one comparable string — '' when they leave
 * everything where it is without them.
 */
function motionOver(moving: Clip[][], from: Frame, to: Frame): string {
  let digest = 0
  let any = false
  moving.forEach((clips, lane) => {
    for (const c of clips) {
      const a = Math.max(from, c.start)
      const b = Math.min(to, clipEnd(c))
      for (let frame = a; frame < b; frame++) {
        const at = movedAt(c, frame - c.start)
        if (at === still(c)) continue
        any = true
        digest = hashString(`${digest}|${lane}:${frame - from}:${at}`)
      }
    }
  })
  return any ? String(digest) : ''
}

// ─── Lining two versions up ──────────────────────────────────────────────

/** The longest run of slices the two versions share, in order: pairs of indexes. */
function common(a: string[], b: string[]): [number, number][] {
  const n = a.length
  const m = b.length
  if (n * m > MOST) {
    const pairs: [number, number][] = []
    let head = 0
    while (head < n && head < m && a[head] === b[head]) pairs.push([head, head++])
    let tail = 0
    while (tail < n - head && tail < m - head && a[n - 1 - tail] === b[m - 1 - tail]) tail++
    for (let k = tail; k > 0; k--) pairs.push([n - k, m - k])
    return pairs
  }
  // Lengths of the longest common subsequence of a[i..] and b[j..].
  const table = new Uint32Array((n + 1) * (m + 1))
  const at = (i: number, j: number) => i * (m + 1) + j
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) table[at(i, j)] = a[i] === b[j] ? table[at(i + 1, j + 1)] + 1 : Math.max(table[at(i + 1, j)], table[at(i, j + 1)])
  const pairs: [number, number][] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) pairs.push([i++, j++])
    else if (table[at(i + 1, j)] >= table[at(i, j + 1)]) i++
    else j++
  }
  return pairs
}

/** How far frame-by-frame trimming of a hunk goes: beyond this the hunk is left as wide as its slices. */
const REFINE = 3000
/** The most frame pairs a stretch is lined up over, frame by frame: about eighty seconds against eighty seconds at 30 fps. */
const FINE = 6_000_000
/** The most pairs lined up at all. Past this (tens of thousands of cuts against as many) only what the two share at their start and end is found. */
const MOST = 25_000_000
/** Fewer frames in common than this, between two differences, is a coincidence, not a stretch the versions share. */
const MIN_SAME = 3

/**
 * A stretch that differs, looked at frame by frame: the two versions may still
 * share a run of frames inside it (a clip that was only trimmed, between two
 * that were swapped), which splits it into the stretches that really differ.
 */
function split(la: Lane[], lb: Lane[], a0: Frame, a1: Frame, b0: Frame, b1: Frame): [Frame, Frame, Frame, Frame][] {
  const n = a1 - a0
  const m = b1 - b0
  if (n === 0 || m === 0 || n * m > FINE) return [[a0, a1, b0, b1]]
  const ta = Array.from({ length: n }, (_, i) => contentAt(la, a0 + i))
  const tb = Array.from({ length: m }, (_, j) => contentAt(lb, b0 + j))
  // Runs of consecutive pairs: frames that follow one another in both versions.
  const runs: { i: number; j: number; length: number }[] = []
  for (const [i, j] of common(ta, tb)) {
    const last = runs[runs.length - 1]
    if (last && last.i + last.length === i && last.j + last.length === j) last.length++
    else runs.push({ i, j, length: 1 })
  }
  const out: [Frame, Frame, Frame, Frame][] = []
  let i = 0
  let j = 0
  for (const run of runs) {
    if (run.length < MIN_SAME) continue
    if (run.i > i || run.j > j) out.push([a0 + i, a0 + run.i, b0 + j, b0 + run.j])
    i = run.i + run.length
    j = run.j + run.length
  }
  if (i < n || j < m) out.push([a0 + i, a1, b0 + j, b1])
  return out
}

/**
 * The stretches where two versions of a timeline differ, in order. Each says
 * where it is in either version; between them the versions play the same
 * thing, possibly at different times (an earlier stretch got longer or shorter).
 */
export function diffTimelines(a: Version, b: Version): TimelineDiff {
  const pairs = pairTracks(a.tracks, b.tracks)
  const la = lanes(
    a,
    pairs.map((p) => p[0]),
  )
  const lb = lanes(
    b,
    pairs.map((p) => p[1]),
  )
  const sa = slices(la)
  const sb = slices(lb)
  const lengthA = sa.length ? sa[sa.length - 1].start + sa[sa.length - 1].length : 0
  const lengthB = sb.length ? sb[sb.length - 1].start + sb[sb.length - 1].length : 0
  const same = common(
    sa.map((s) => `${s.length}#${s.token}`),
    sb.map((s) => `${s.length}#${s.token}`),
  )
  const hunks: Hunk[] = []
  let i = 0
  let j = 0
  const flush = (toI: number, toJ: number) => {
    if (toI === i && toJ === j) return
    let a0 = i < sa.length ? sa[i].start : lengthA
    let a1 = toI < sa.length ? sa[toI].start : lengthA
    let b0 = j < sb.length ? sb[j].start : lengthB
    let b1 = toJ < sb.length ? sb[toJ].start : lengthB
    // Slices are coarse: a clip trimmed by a few frames makes the whole slice differ. Frame by frame, what the two
    // stretches share at their heads and tails is taken back off.
    for (let n = 0; n < REFINE && a0 < a1 && b0 < b1 && contentAt(la, a0) === contentAt(lb, b0); n++) (a0++, b0++)
    for (let n = 0; n < REFINE && a0 < a1 && b0 < b1 && contentAt(la, a1 - 1) === contentAt(lb, b1 - 1); n++) (a1--, b1--)
    if (a0 === a1 && b0 === b1) return
    for (const [x0, x1, y0, y1] of split(la, lb, a0, a1, b0, b1)) hunks.push({ a: [x0, x1], b: [y0, y1], kind: x0 === x1 ? 'added' : y0 === y1 ? 'removed' : 'changed' })
  }
  for (const [pi, pj] of same) {
    flush(pi, pj)
    i = pi + 1
    j = pj + 1
  }
  flush(sa.length, sb.length)
  return {
    hunks,
    framesA: hunks.reduce((n, h) => n + h.a[1] - h.a[0], 0),
    framesB: hunks.reduce((n, h) => n + h.b[1] - h.b[0], 0),
    lengthA,
    lengthB,
  }
}

/**
 * The frame of the second version that goes with a frame of the first: the same
 * moment where the two agree, the matching point of the stretch (in proportion)
 * where they differ.
 */
export function mapFrame(diff: TimelineDiff, frame: Frame, from: 'a' | 'b' = 'a'): Frame {
  const to = from === 'a' ? 'b' : 'a'
  let shift = 0
  for (const h of diff.hunks) {
    const [s0, s1] = h[from]
    const [t0, t1] = h[to]
    if (frame < s0) break
    if (frame < s1) return t1 > t0 ? Math.min(t1 - 1, t0 + Math.floor(((frame - s0) / (s1 - s0)) * (t1 - t0))) : t0
    shift = t1 - s1
  }
  return Math.max(0, frame + shift)
}

/** The hunk a frame of a version is in, if it is in one (a stretch only the other version has sits on a single frame here). */
export const hunkAt = (diff: TimelineDiff, frame: Frame, side: 'a' | 'b' = 'a') =>
  diff.hunks.find((h) => {
    const [from, to] = h[side]
    return to > from ? frame >= from && frame < to : frame === from
  })

// ─── Taking a stretch from one version into another ──────────────────────

/**
 * Makes the open timeline (a draft) play, over the hunk's stretch, what the
 * other version plays there: its own stretch comes out, room for the other's
 * goes in, and copies of the other's clips fill it — on every track that
 * follows ripples, so everything after stays in step. Tracks the other version
 * has and this one hasn't are added. Returns the ids of the clips put in.
 */
export function takeHunk(p: Project, from: Version, hunk: Hunk): string[] {
  const [a0, a1] = hunk.a
  const [b0, b1] = hunk.b
  // What the other version plays in its stretch. In an empty one — a stretch only this version has, which simply
  // comes out — it plays nothing: but a clip that runs *through* that point there was taken for one in it, and a
  // frame of it was copied in where the stretch had been, over whatever had just closed up.
  const inStretch = (c: Clip) => b1 > b0 && c.start < b1 && clipEnd(c) > b0
  const pairs = pairTracks(p.tracks, from.tracks)
  // Tracks that only the other version has come along, placed as they are there: video above, audio below.
  const target = new Map<string, Track>()
  for (const [mine, theirs] of pairs) {
    if (!theirs) continue
    if (mine) {
      target.set(theirs.id, mine)
      continue
    }
    if (!Object.values(from.clips).some((c) => c.trackId === theirs.id && inStretch(c))) continue
    const track = createTrack(theirs.kind, { name: theirs.name, height: theirs.height, origin: theirs.origin ?? theirs.id, ...(theirs.role && theirs.role !== 'main' ? { role: theirs.role } : {}) })
    if (theirs.kind === 'video') p.tracks.unshift(track)
    else p.tracks.push(track)
    target.set(theirs.id, track)
  }

  if (a1 > a0) removeRange(p, a0, a1)
  if (b1 > b0) rippleInsert(p, a0, b1 - b0)

  const groups = new Map<string, string>()
  const added: string[] = []
  const incoming = Object.values(from.clips)
    .filter((c) => inStretch(c) && target.has(c.trackId) && followsRipple(target.get(c.trackId)!))
    .sort((x, y) => x.start - y.start)
  // On the main track the copies go in just ahead of whatever now starts at the join, in their order.
  const onMain = incoming.filter((c) => isMagnetic(target.get(c.trackId)!))
  for (const source of incoming) {
    const track = target.get(source.trackId)!
    const clip = cloneClip(source)
    clip.id = uid('clip')
    // Only the part inside the stretch comes over.
    if (clip.start < b0) {
      setClipStart(clip, b0)
      clip.transitionIn = null
    }
    if (clipEnd(clip) > b1) setClipEnd(clip, b1)
    clip.trackId = track.id
    clip.effects = clip.effects.map((e) => ({ ...e, id: uid('fx') }))
    if (clip.masks) clip.masks = clip.masks.map((m) => ({ ...m, id: uid('mask') }))
    if (clip.groupId) {
      if (!groups.has(clip.groupId)) groups.set(clip.groupId, uid('grp'))
      clip.groupId = groups.get(clip.groupId)
    }
    clip.start = isMagnetic(track) ? a0 - 1 + (onMain.indexOf(source) + 1) / (onMain.length + 1) : clip.start - b0 + a0
    p.clips[clip.id] = clip
    added.push(clip.id)
  }
  // A group that came over with a single member isn't one.
  const counts = new Map<string, number>()
  for (const id of added) {
    const g = p.clips[id].groupId
    if (g) counts.set(g, (counts.get(g) ?? 0) + 1)
  }
  for (const id of added) if (p.clips[id].groupId && counts.get(p.clips[id].groupId!) === 1) delete p.clips[id].groupId

  // The other version's markers in the stretch come too, unless one just like it is already there.
  for (const m of from.markers ?? []) {
    if (m.frame < b0 || m.frame >= Math.max(b1, b0 + 1)) continue
    const frame = m.frame - b0 + a0
    if (p.markers.some((x) => x.frame === frame && x.label === m.label)) continue
    p.markers.push({ ...m, id: uid('mk'), frame })
  }
  p.markers.sort((x, y) => x.frame - y.frame)
  return added
}
