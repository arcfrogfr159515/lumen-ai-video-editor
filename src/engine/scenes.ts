/**
 * Scene detection: where the shot changes in a piece of footage. Two things are read off every frame, small:
 *
 * - how much the picture changes from the frame before, in hue, saturation and brightness. A cut is a jump
 *   well above what the frames around it do (so fast motion isn't mistaken for one) that the picture doesn't
 *   come back from, as it does from a flash or a glitch frame;
 * - how much its colour make-up — a histogram, which moving or zooming the picture barely changes — differs
 *   from that of the frame a little under half a second earlier. A shot that gives way to the next through a
 *   dissolve, a wipe or a blur never jumps like that, but its colours change over that stretch and then stay
 *   changed.
 *
 * Cuts are kept a minimum distance apart, and from either end of the footage.
 */
import type { Asset } from '@/editor/types'
import { tt } from '@/lib/i18n'
import { clamp } from '@/lib/math'
import { scanFrames, toGray } from './analysis'

/** HSV per pixel (hue 0..180, saturation and value 0..255), like OpenCV's. */
export function toHsv(rgba: Uint8ClampedArray, out: Float32Array = new Float32Array((rgba.length / 4) * 3)): Float32Array {
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
    const r = rgba[i]
    const g = rgba[i + 1]
    const b = rgba[i + 2]
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const d = max - min
    let h = 0
    if (d > 0) {
      if (max === r) h = ((g - b) / d) % 6
      else if (max === g) h = (b - r) / d + 2
      else h = (r - g) / d + 4
      h *= 30
      if (h < 0) h += 180
    }
    out[j] = h
    out[j + 1] = max ? (d / max) * 255 : 0
    out[j + 2] = max
  }
  return out
}

/** How different two frames look: the mean change in hue (around the wheel), saturation and brightness. */
export function contentDelta(a: ArrayLike<number>, b: ArrayLike<number>) {
  let dh = 0
  let ds = 0
  let dv = 0
  for (let i = 0; i < a.length; i += 3) {
    let h = Math.abs(a[i] - b[i])
    if (h > 90) h = 180 - h
    dh += h
    ds += Math.abs(a[i + 1] - b[i + 1])
    dv += Math.abs(a[i + 2] - b[i + 2])
  }
  const n = a.length / 3
  return (dh + ds + dv) / (3 * n)
}

// ─── Colour make-up ──────────────────────────────────────────────────────

const HUES = 8
const SATURATIONS = 4
const VALUES = 4

/**
 * A frame's colour make-up: the share of its pixels (HSV, from toHsv) in each of 8 hues × 4 saturations × 4
 * brightnesses. Grey and near-black pixels have no hue worth the name and share one.
 */
export function colorHistogram(hsv: ArrayLike<number>, out: Float32Array = new Float32Array(HUES * SATURATIONS * VALUES)): Float32Array {
  out.fill(0)
  for (let i = 0; i < hsv.length; i += 3) {
    const s = Math.min(SATURATIONS - 1, Math.floor((hsv[i + 1] / 256) * SATURATIONS))
    const v = Math.min(VALUES - 1, Math.floor((hsv[i + 2] / 256) * VALUES))
    const h = s === 0 || v === 0 ? 0 : Math.min(HUES - 1, Math.floor((hsv[i] / 180) * HUES))
    out[(h * SATURATIONS + s) * VALUES + v]++
  }
  const n = hsv.length / 3
  for (let k = 0; k < out.length; k++) out[k] /= n
  return out
}

/** How different two colour make-ups are: 0 for the same, 1 for nothing in common. */
export function histogramDelta(a: ArrayLike<number>, b: ArrayLike<number>) {
  let d = 0
  for (let k = 0; k < a.length; k++) d += Math.abs(a[k] - b[k])
  return d / 2
}

/**
 * Three frames (luma), the middle one half-way between the others in time: how far it is from the mean of
 * the outer two, as a share of how far apart those are. Near 0 half-way through a dissolve, which is that
 * mean; about a half across a cut or a wipe; anything when the picture just moves.
 */
export function blendResidual(first: ArrayLike<number>, middle: ArrayLike<number>, last: ArrayLike<number>) {
  let off = 0
  let apart = 0
  for (let k = 0; k < middle.length; k++) {
    off += Math.abs(middle[k] - (first[k] + last[k]) / 2)
    apart += Math.abs(first[k] - last[k])
  }
  // Ends that are all but the same say nothing about what happened between them.
  return apart > middle.length * 0.5 ? off / apart : 1
}

// ─── Finding the cuts ────────────────────────────────────────────────────

export interface SceneOptions {
  /** 0..100: higher finds subtler cuts (default 50). */
  sensitivity?: number
  /** Shortest shot, in seconds (default 0.6). */
  minShot?: number
}

/**
 * Thresholds for a sensitivity: how far above the frames around it a frame must jump (`ratio`) and by how much
 * at least (`minContent`) to be a cut, and how much of the colour make-up must change (`minShift`, 0..1) for a
 * transition.
 */
export function sceneThresholds(sensitivity = 50) {
  const s = Math.min(100, Math.max(0, sensitivity)) / 100
  return { ratio: 5 - 3.2 * s, minContent: 26 - 18 * s, minShift: 0.48 - 0.36 * s }
}

function median(values: number[]) {
  if (!values.length) return 0
  values.sort((a, b) => a - b)
  const m = values.length >> 1
  return values.length % 2 ? values[m] : (values[m - 1] + values[m]) / 2
}

/** The median of the `w` scores before frame i (dir -1) or after it (dir 1). */
function usual(scores: ArrayLike<number>, i: number, w: number, dir: -1 | 1) {
  const near: number[] = []
  for (let k = 1; k <= w; k++) {
    const j = i + dir * k
    if (j >= 1 && j < scores.length) near.push(scores[j])
  }
  return median(near)
}

/** The least share of a jump that must still be there a frame or two either side of it, for a cut. */
const HOLD = 0.8

export interface CutOptions {
  ratio: number
  minContent: number
  /** Fewest frames between two cuts, and between a cut and either end. */
  minGap: number
  /** Frames looked at either side of a frame for what is usual there (default 8). */
  window?: number
  /** stays[i]: what is left of the jump at frame i a frame or two either side of it (see sceneScanner). */
  stays?: ArrayLike<number>
}

/**
 * Cut indices from per-frame scores (score[i] compares frame i with frame i-1): frame i starts a new shot when
 * its score is at least `minContent` and `ratio` times what is usual either side of it — the higher of the two
 * medians, so the blur of a transition leading up to a cut, or a second jump right beside it, doesn't hide it,
 * while a stretch of fast motion still does. With `stays`, a jump the picture comes straight back from (a
 * flash, a glitch frame) isn't a cut. Of frames in a row that all qualify the biggest jump is the cut, and cuts
 * are `minGap` frames apart and from either end.
 */
export function cutsFromScores(scores: ArrayLike<number>, opts: CutOptions): number[] {
  const w = opts.window ?? 8
  const n = scores.length
  const jumps = (i: number) => {
    const s = scores[i]
    if (s < opts.minContent) return false
    if (s / Math.max(1, usual(scores, i, w, -1), usual(scores, i, w, 1)) < opts.ratio) return false
    return !opts.stays || !(opts.stays[i] < HOLD * s)
  }
  const cuts: number[] = []
  let last = 0
  for (let i = 1; i < n; i++) {
    if (!jumps(i)) continue
    let best = i
    while (i + 1 < n && jumps(i + 1)) {
      i++
      if (scores[i] > scores[best]) best = i
    }
    if (best - last < opts.minGap || n - best < opts.minGap) continue
    cuts.push(best)
    last = best
  }
  return cuts
}

/** Median of five: takes out what one or two odd frames (a flash) do to a signal, and leaves its edges where they are. */
function despike(values: ArrayLike<number>) {
  const n = values.length
  const out = new Float64Array(n)
  const five = [0, 0, 0, 0, 0]
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 5; k++) five[k] = values[clamp(i - 2 + k, 0, n - 1)]
    out[i] = median(five)
  }
  return out
}

/** A transition's stretch is about `span` frames wide: this much of it at least, or it is something that passed. */
const BRIEF = 0.7
/** …and up to this much of it for a quick transition; wider ones have to be dissolves. */
const QUICK = 1.6
/** The most a frame half-way through a dissolve is off the mean of the frames before and after (blendResidual). */
const BLENDED = 0.45

export interface ShiftOptions {
  /** Frames between the two frames whose colour make-up is compared. */
  span: number
  /** How much of it must change, 0..1. */
  min: number
  /** blend[i]: blendResidual of frames i - 2·span, i - span and i. Without it only quick transitions are found. */
  blend?: ArrayLike<number>
  /** The widest stretch, in frames, a slow dissolve may stand out over (default 4 × span). */
  maxWidth?: number
}

export interface SceneShift {
  /** The first frame of the later half of the transition: where to cut. */
  at: number
  /** The frames of `change` it stands out over. */
  from: number
  to: number
  /** How much of the colour make-up changed, 0..1. */
  peak: number
}

/**
 * Transitions, from how much the colour make-up changes over `span` frames (change[i] compares frame i with
 * frame i - span). One shot giving way to another — by a cut, a wipe, a blur or a dissolve — raises it for
 * about `span` frames and then lets it fall back, because the new shot stays; so each peak of at least `min`
 * is taken with the stretch around it that stays above half of it. A stretch much shorter than `span` is
 * something that passed (a few odd frames). One much longer is the picture changing steadily (someone walking
 * up to the lens) — unless half-way through it the frame is the mean of the frames before and after, which
 * is what a slow dissolve is and motion isn't.
 */
export function shiftsFromChange(change: ArrayLike<number>, opts: ShiftOptions): SceneShift[] {
  const n = change.length
  const { span } = opts
  const c = despike(change)
  const blend = opts.blend ? despike(opts.blend) : null
  const peaks: number[] = []
  for (let i = 0; i < n; i++) if (c[i] >= opts.min) peaks.push(i)
  peaks.sort((x, y) => c[y] - c[x] || x - y)
  const taken = new Uint8Array(n)
  const shifts: SceneShift[] = []
  for (const peak of peaks) {
    if (taken[peak]) continue
    const half = c[peak] / 2
    let from = peak
    let to = peak
    while (from > 0 && c[from - 1] >= half && !taken[from - 1]) from--
    while (to + 1 < n && c[to + 1] >= half && !taken[to + 1]) to++
    // Right beside a higher peak's stretch: its shoulder, not a change of its own.
    const shoulder = (from > 0 && taken[from - 1]) || (to + 1 < n && taken[to + 1])
    taken.fill(1, from, to + 1)
    if (shoulder) continue
    const width = to - from + 1
    if (width < BRIEF * span) continue
    if (width > QUICK * span) {
      if (!blend || width > (opts.maxWidth ?? 4 * span)) continue
      let low = 1
      for (let k = from; k <= Math.min(n - 1, to + span); k++) low = Math.min(low, blend[k])
      if (low > BLENDED) continue
    }
    // change is raised from the frame the transition starts on to `span` frames past its last.
    shifts.push({ at: Math.ceil((from + to - span) / 2), from, to, peak: c[peak] })
  }
  return shifts.sort((x, y) => x.at - y.at)
}

/** What is read off the frames of a stretch of footage, one value a frame. */
export interface SceneSignals {
  /** scores[i]: how much frame i differs from frame i-1 (contentDelta). */
  scores: ArrayLike<number>
  /** stays[i]: the least frame i differs from frames i-2 and i-3, and frames i+1 and i+2 from frame i-1. */
  stays?: ArrayLike<number>
  /** change[i]: how much the colour make-up of frame i differs from that of frame i - span. */
  change?: ArrayLike<number>
  /** blend[i]: blendResidual of frames i - 2·span, i - span and i. */
  blend?: ArrayLike<number>
}

export interface SceneCutOptions {
  ratio: number
  minContent: number
  minShift: number
  /** Frames between the two frames whose colour make-up `change` compares. */
  span: number
  /** Fewest frames between two cuts, and between a cut and either end. */
  minGap: number
  window?: number
  maxWidth?: number
}

/**
 * Where new shots begin, from everything read off the frames: the jumps (cutsFromScores), and the transitions
 * (shiftsFromChange) that no jump marks — cut, within a frame or two of their middle, on the frame that
 * changes most. Where two are closer than the shortest shot the surer one stays: a jump inside a transition,
 * then a transition, then a jump alone.
 */
export function sceneCuts(signals: SceneSignals, opts: SceneCutOptions): number[] {
  const { scores } = signals
  const n = scores.length
  const found = cutsFromScores(scores, { ratio: opts.ratio, minContent: opts.minContent, minGap: 1, window: opts.window, stays: signals.stays }).map((at) => ({ at, sure: 1, strength: scores[at] }))
  for (const shift of signals.change ? shiftsFromChange(signals.change, { span: opts.span, min: opts.minShift, blend: signals.blend, maxWidth: opts.maxWidth }) : []) {
    const jumps = found.filter((f) => f.at >= shift.from - 3 && f.at <= shift.to - opts.span + 3)
    if (jumps.length) {
      jumps.reduce((a, b) => (b.strength > a.strength ? b : a)).sure = 3
      continue
    }
    let at = clamp(shift.at, 1, n - 1)
    for (let k = Math.max(1, shift.at - 2); k <= Math.min(n - 1, shift.at + 2); k++) if (scores[k] > scores[at]) at = k
    found.push({ at, sure: 2, strength: shift.peak })
  }
  found.sort((a, b) => b.sure - a.sure || b.strength - a.strength || a.at - b.at)
  const cuts: number[] = []
  for (const { at } of found) {
    if (at < opts.minGap || n - at < opts.minGap) continue
    if (cuts.some((c) => Math.abs(c - at) < opts.minGap)) continue
    cuts.push(at)
  }
  return cuts.sort((a, b) => a - b)
}

// ─── Reading the frames ──────────────────────────────────────────────────

/**
 * Reads the signals off frames as they are decoded, holding on to only the few frames it compares each new
 * one with: `add` every frame's pixels in order, then take `signals()`.
 */
export function sceneScanner(span: number) {
  const scores: number[] = []
  /** Frame i against frames i-2 and i-3. */
  const two: number[] = []
  const three: number[] = []
  const change: number[] = []
  const blend: number[] = []
  /** HSV of the frames just before, newest first. */
  const recent: Float32Array[] = []
  // Rings, each frame in the slot of its index: a frame's histogram is needed `span` frames on, its luma twice that.
  const histograms: Float32Array[] = []
  const lumas: ReturnType<typeof toGray>[] = []
  const H = span + 1
  const L = 2 * span + 1
  return {
    add(rgba: Uint8ClampedArray) {
      const i = scores.length
      const hsv = toHsv(rgba, recent.length > 3 ? recent.pop() : undefined)
      scores.push(recent[0] ? contentDelta(recent[0], hsv) : 0)
      two.push(recent[1] ? contentDelta(recent[1], hsv) : Infinity)
      three.push(recent[2] ? contentDelta(recent[2], hsv) : Infinity)
      recent.unshift(hsv)
      const histogram = (histograms[i % H] = colorHistogram(hsv, histograms[i % H]))
      change.push(i >= span ? histogramDelta(histograms[(i + 1) % H], histogram) : 0)
      const luma = (lumas[i % L] = toGray(rgba, lumas[i % L]))
      blend.push(i >= 2 * span ? blendResidual(lumas[(i + 1) % L], lumas[(i + span + 1) % L], luma) : 1)
    },
    signals(): SceneSignals {
      const n = scores.length
      const stays = new Float64Array(n)
      for (let i = 0; i < n; i++) stays[i] = Math.min(two[i], three[i], i + 1 < n ? two[i + 1] : Infinity, i + 2 < n ? three[i + 2] : Infinity)
      return { scores, stays, change, blend }
    },
  }
}

export interface SceneReport {
  /** Source seconds where new shots begin. */
  cuts: number[]
  frames: number
}

/** Seconds between the two frames whose colour make-up is compared: about as long as a quick transition takes. */
const SHIFT_SECONDS = 0.4

/**
 * Shot changes in source seconds [from, to) of a video. `onProgress` gets 0..1.
 */
export async function detectScenes(asset: Asset, from: number, to: number, opts: SceneOptions = {}, onProgress?: (p: number) => void, signal?: AbortSignal): Promise<SceneReport> {
  if (asset.kind !== 'video' || asset.source.type !== 'file') throw new Error(tt('“{0}” isn’t a video file.', asset.name))
  if (asset.source.missing) throw new Error(tt('“{0}” is offline — its file can’t be found.', asset.name))
  const fps = asset.fps ?? 30
  const span = clamp(Math.round(SHIFT_SECONDS * fps), 4, 30)
  const scanner = sceneScanner(span)
  const times: number[] = []
  await scanFrames(
    asset.source.url,
    from,
    to,
    96,
    ({ t, rgba }) => {
      scanner.add(rgba)
      times.push(t)
      onProgress?.(Math.min(1, (t - from) / Math.max(1e-3, to - from)))
    },
    signal,
  )
  const cuts = sceneCuts(scanner.signals(), {
    ...sceneThresholds(opts.sensitivity),
    span,
    window: clamp(Math.round(0.27 * fps), 4, 20),
    minGap: Math.max(2, Math.round((opts.minShot ?? 0.6) * fps)),
    maxWidth: span + Math.round(1.5 * fps),
  })
  return { cuts: cuts.map((i) => times[i]), frames: times.length }
}
