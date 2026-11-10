/**
 * The speed curve of a clip: points saying how fast it plays at moments along
 * its length, joined by Bézier curves. This is the arithmetic behind the
 * curve editor — a segment's shape as two handles, the speed anywhere along
 * the curve, and what the curve does to the clip's length and to which part
 * of the footage shows when (time remapping).
 */
import { clamp } from '@/lib/math'
import { bezier, easeAt, type Easing } from './easing'
import { isRamped, MAX_SPEED, MIN_SPEED } from './timing'
import type { Clip } from './types'

export interface CurvePoint {
  /** Where along the clip, 0 (its start) to 1 (its end). */
  at: number
  /** Speed there, 0.1× to 16×. */
  speed: number
  /** The shape of the curve from this point to the next. */
  easing: Easing
}

/**
 * A segment's shape as the two inner control points of a cubic Bézier, in the
 * box the segment spans: x from 0 (its first point) to 1 (its last), y the same
 * way between the two speeds. The same numbers as CSS cubic-bezier().
 */
export type Handles = [x1: number, y1: number, x2: number, y2: number]

const BEZIER = /^cubic-bezier\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)$/

const round3 = (n: number) => Math.round(n * 1000) / 1000

const fitted = new Map<string, Handles>()

/**
 * The Bézier nearest a named curve. For each place the two handles could sit
 * along the segment, the heights that fit the curve best are a small linear
 * problem (a Bézier's height is a weighted sum of its handles' heights); the
 * placing with the least error wins.
 */
function fit(easing: string): Handles {
  const hit = fitted.get(easing)
  if (hit) return hit
  const ts = Array.from({ length: 19 }, (_, i) => (i + 1) / 20)
  const want = ts.map((t) => easeAt(easing, t))
  let best: Handles = [1 / 3, 1 / 3, 2 / 3, 2 / 3]
  let least = Infinity
  for (let i = 0; i <= 10; i++) {
    for (let j = 0; j <= 10; j++) {
      const x1 = i / 10
      const x2 = j / 10
      // What each handle's height contributes at each sample, and what is there with both at zero.
      const zero = bezier(x1, 0, x2, 0)
      const first = bezier(x1, 1, x2, 0)
      const second = bezier(x1, 0, x2, 1)
      let a11 = 0
      let a12 = 0
      let a22 = 0
      let b1 = 0
      let b2 = 0
      const rows = ts.map((t, k) => {
        const c = zero(t)
        const u = first(t) - c
        const v = second(t) - c
        a11 += u * u
        a12 += u * v
        a22 += v * v
        b1 += u * (want[k] - c)
        b2 += v * (want[k] - c)
        return [u, v, c]
      })
      const det = a11 * a22 - a12 * a12
      if (Math.abs(det) < 1e-9) continue
      const y1 = (b1 * a22 - b2 * a12) / det
      const y2 = (a11 * b2 - a12 * b1) / det
      const error = rows.reduce((sum, [u, v, c], k) => sum + (u * y1 + v * y2 + c - want[k]) ** 2, 0)
      if (error < least) {
        least = error
        best = [x1, round3(y1), x2, round3(y2)]
      }
    }
  }
  fitted.set(easing, best)
  return best
}

/**
 * The handles that draw an easing. A cubic-bezier gives its own and a straight
 * line is a straight line; any other named curve gets the Bézier that follows
 * it most closely — near enough to start reshaping from without the curve
 * jumping.
 */
export function handlesOf(easing: Easing | string | undefined): Handles {
  const m = BEZIER.exec(easing ?? '')
  if (m) return [clamp(Number(m[1]), 0, 1), Number(m[2]), clamp(Number(m[3]), 0, 1), Number(m[4])]
  if (easing === 'linear') return [0, 0, 1, 1]
  return [...fit(easing ?? 'ease')]
}

/** The easing a pair of handles makes: a cubic-bezier, or `linear` when that is what they draw. */
export function easingOf(h: Handles): Easing {
  const v: Handles = [round3(clamp(h[0], 0, 1)), round3(clamp(h[1], -2, 3)), round3(clamp(h[2], 0, 1)), round3(clamp(h[3], -2, 3))]
  // Both handles on the diagonal draw a straight line, wherever along it they sit.
  if (Math.abs(v[0] - v[1]) < 0.0005 && Math.abs(v[2] - v[3]) < 0.0005) return 'linear'
  return `cubic-bezier(${v.join(', ')})`
}

/** The shapes a segment can be given in one go. */
export const SEGMENT_SHAPES: { id: Easing; label: string; hint: string }[] = [
  { id: 'ease', label: 'Smooth', hint: 'Eases out of one speed and into the next' },
  { id: 'linear', label: 'Straight', hint: 'Changes speed at a steady rate' },
  { id: 'ease-in', label: 'Late', hint: 'Holds on, then changes quickly at the end' },
  { id: 'ease-out', label: 'Early', hint: 'Changes quickly, then settles' },
  { id: 'hold', label: 'Hold', hint: 'Stays at this speed, then jumps to the next' },
]

const clampSpeed = (s: number) => clamp(s, MIN_SPEED, MAX_SPEED)

/** A clip's speed curve: its ramp's points, or two points at its constant speed. */
export function curvePoints(clip: Pick<Clip, 'speed' | 'duration' | 'keyframes'>): CurvePoint[] {
  if (!isRamped(clip)) return [
    { at: 0, speed: clip.speed, easing: 'ease' },
    { at: 1, speed: clip.speed, easing: 'ease' },
  ]
  return clip.keyframes.speed!.map((k) => ({ at: clamp(k.frame / Math.max(1, clip.duration), 0, 1), speed: k.value, easing: k.easing }))
}

/** The speed the curve gives at a moment along the clip (0..1). */
export function speedOnCurve(points: readonly CurvePoint[], at: number): number {
  if (!points.length) return 1
  if (at <= points[0].at) return clampSpeed(points[0].speed)
  const last = points[points.length - 1]
  if (at >= last.at) return clampSpeed(last.speed)
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]
    const b = points[i + 1]
    if (at >= a.at && at < b.at) return clampSpeed(a.speed + (b.speed - a.speed) * easeAt(a.easing, (at - a.at) / (b.at - a.at)))
  }
  return clampSpeed(last.speed)
}

const STEPS = 1000

/** The curve's average speed over the clip — what decides how long the clip is for the footage it plays. */
export function curveAverage(points: readonly CurvePoint[]): number {
  let sum = 0
  for (let k = 0; k <= STEPS; k++) sum += speedOnCurve(points, k / STEPS)
  return sum / (STEPS + 1)
}

/** How long a clip playing `sourceFrames` of footage along this curve comes out, in frames. */
export const curveLength = (points: readonly CurvePoint[], sourceFrames: number) => Math.max(2, Math.round(sourceFrames / curveAverage(points)))

/**
 * Time remapping: how much of the footage has played by each moment of the
 * clip. `samples + 1` values from 0 to 1 — a straight diagonal at constant
 * speed, steep where the clip runs fast, flat where it nearly stops.
 */
export function footageCurve(points: readonly CurvePoint[], samples = 64): number[] {
  const out = [0]
  let sum = 0
  let prev = speedOnCurve(points, 0)
  for (let i = 1; i <= samples; i++) {
    // Finer steps inside each sample, so sharp curves are measured, not skipped over.
    for (let j = 1; j <= 8; j++) {
      const next = speedOnCurve(points, (i - 1 + j / 8) / samples)
      sum += (prev + next) / 2
      prev = next
    }
    out.push(sum)
  }
  return sum > 0 ? out.map((v) => v / sum) : out
}

// ─── Editing ─────────────────────────────────────────────────────────────

/** The smallest gap between two points, so a segment always has some length. */
export const MIN_GAP = 0.02

/** Moves a point: the ends stay at the clip's edges, the others between their neighbours. */
export function movePoint(points: readonly CurvePoint[], index: number, at: number, speed: number): CurvePoint[] {
  return points.map((p, i) => {
    if (i !== index) return p
    const first = i === 0
    const last = i === points.length - 1
    return { ...p, at: first ? 0 : last ? 1 : clamp(at, points[i - 1].at + MIN_GAP, points[i + 1].at - MIN_GAP), speed: round3(clampSpeed(speed)) }
  })
}

/**
 * Adds a point on the curve at `at`, at the speed the curve has there, so the
 * curve's values at its points are unchanged. Null when there is no room.
 */
export function insertPoint(points: readonly CurvePoint[], at: number): CurvePoint[] | null {
  const i = points.findIndex((p, k) => k < points.length - 1 && at > p.at && at < points[k + 1].at)
  if (i < 0) return null
  const a = points[i]
  const b = points[i + 1]
  if (at - a.at < MIN_GAP || b.at - at < MIN_GAP) return null
  const point: CurvePoint = { at, speed: round3(speedOnCurve(points, at)), easing: a.easing }
  return [...points.slice(0, i + 1), point, ...points.slice(i + 1)]
}

/** Removes a point (never an end: a curve keeps both). */
export function removePoint(points: readonly CurvePoint[], index: number): CurvePoint[] {
  if (index <= 0 || index >= points.length - 1) return [...points]
  return points.filter((_, i) => i !== index)
}

/** Gives the segment that starts at point `index` a shape. */
export function shapeSegment(points: readonly CurvePoint[], index: number, easing: Easing): CurvePoint[] {
  return points.map((p, i) => (i === index ? { ...p, easing } : p))
}

/**
 * Where a segment's handle sits on the graph: its moment along the clip and
 * the speed it points at. `which` is 0 for the handle by the segment's first
 * point, 1 for the one by its last.
 */
export function handlePosition(points: readonly CurvePoint[], index: number, which: 0 | 1): { at: number; speed: number } | null {
  const a = points[index]
  const b = points[index + 1]
  if (!a || !b || a.easing === 'hold') return null
  const h = handlesOf(a.easing)
  return { at: a.at + h[which * 2] * (b.at - a.at), speed: a.speed + h[which * 2 + 1] * (b.speed - a.speed) }
}

/** Drags a segment's handle to a moment and a speed on the graph: the segment's new shape. */
export function dragHandle(points: readonly CurvePoint[], index: number, which: 0 | 1, at: number, speed: number): CurvePoint[] {
  const a = points[index]
  const b = points[index + 1]
  if (!a || !b) return [...points]
  const h = handlesOf(a.easing === 'hold' ? 'linear' : a.easing)
  h[which * 2] = clamp((at - a.at) / (b.at - a.at), 0, 1)
  // Between two equal speeds a handle has no height to speak of: it keeps what it had.
  if (Math.abs(b.speed - a.speed) > 1e-6) h[which * 2 + 1] = clamp((speed - a.speed) / (b.speed - a.speed), -2, 3)
  return shapeSegment(points, index, easingOf(h))
}

/** The points as clip.setSpeedRamp takes them. */
export const rampInput = (points: readonly CurvePoint[]) => points.map((p) => ({ at: round3(clamp(p.at, 0, 1)), speed: Math.round(clampSpeed(p.speed) * 100) / 100, easing: p.easing }))
