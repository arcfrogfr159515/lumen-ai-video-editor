/**
 * Variable frame rates. Phones, screen recorders and game capture write a
 * frame whenever one is ready, so the time between frames wanders; an editor
 * works on a fixed grid. This reads what a file's frame timestamps say, and
 * picks the constant rate a copy of it should be given.
 */
import type { FrameTiming } from './types'

/** The rates cameras and screens actually run at. */
export const COMMON_RATES = [12, 15, 23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 90, 100, 119.88, 120, 144, 240] as const

/** What a media library reports about a video track's frame timestamps (Mediabunny's FrameRateMetrics). */
export interface RateMetrics {
  /** The rate of the grid every frame sits on, or null when there is no such grid. */
  underlyingFrameRate: number | null
  minFrameRate: number
  maxFrameRate: number
  averageFrameRate: number
  medianFrameRate: number
  /** On a grid with no frame missing. */
  frameRateIsConstant: boolean
  probedPacketCount: number
}

const round3 = (n: number) => Math.round(n * 1000) / 1000

/** Too few frames to tell a frame rate from a coincidence. */
export const MIN_FRAMES = 12

/**
 * What a track's metrics say about it. `variable` means no grid fits the
 * frames; `dropped` means they sit on a grid with frames missing — still
 * uneven to play, but its rate is known.
 */
export function timingFromMetrics(m: RateMetrics): FrameTiming | null {
  if (m.probedPacketCount < MIN_FRAMES || !Number.isFinite(m.medianFrameRate) || m.medianFrameRate <= 0) return null
  const variable = m.underlyingFrameRate === null
  const dropped = !variable && !m.frameRateIsConstant
  return {
    ...(variable ? { variable: true } : {}),
    ...(dropped ? { dropped: true } : {}),
    min: round3(m.minFrameRate),
    max: round3(m.maxFrameRate),
    average: round3(m.averageFrameRate),
    median: round3(m.medianFrameRate),
    ...(m.underlyingFrameRate !== null ? { grid: round3(m.underlyingFrameRate) } : {}),
    frames: m.probedPacketCount,
  }
}

/** A file whose frames don't arrive evenly: worth a constant-rate copy. */
export const isUneven = (t: FrameTiming | undefined) => Boolean(t && (t.variable || t.dropped))

/** The common rate within `tolerance` (a fraction) of `fps`, if there is one. */
export function snapRate(fps: number, tolerance = 0.012): number | null {
  let best: number | null = null
  for (const r of COMMON_RATES) if (Math.abs(r - fps) / r <= tolerance && (best === null || Math.abs(r - fps) < Math.abs(best - fps))) best = r
  return best
}

/**
 * The constant rate to give a copy. The timeline's own when the footage usually
 * runs at it (or at a whole multiple of it, which drops cleanly); a rate cameras
 * use when the footage sits on one; the timeline's again when the footage is
 * merely near it — it will be laid on that grid anyway; else the nearest rate
 * cameras use.
 */
export function constantRateFor(t: FrameTiming, projectFps: number): number {
  const usual = t.grid ?? t.median
  for (const k of [1, 2, 4]) if (Math.abs(usual - projectFps * k) / (projectFps * k) <= 0.02) return projectFps * k
  const common = snapRate(usual, 0.04)
  if (common !== null) return common
  if (Math.abs(usual - projectFps) / projectFps <= 0.12) return projectFps
  return COMMON_RATES.reduce((best, r) => (Math.abs(r - usual) < Math.abs(best - usual) ? r : best), COMMON_RATES[0] as number)
}

const fmt = (fps: number) => (Math.abs(fps - Math.round(fps)) < 0.005 ? String(Math.round(fps)) : fps.toFixed(2).replace(/0$/, ''))

/** A frame rate as it is usually written: 30, 29.97, 23.976. */
export const rateLabel = (fps: number) => (Math.abs(fps - 23.976) < 0.002 ? '23.976' : fmt(fps))

/** What a file's frame timing is, in a line. */
export function describeTiming(t: FrameTiming | undefined): string {
  if (!t) return 'Not checked yet'
  if (t.variable) return `Variable: ${rateLabel(t.min)}–${rateLabel(t.max)} fps, usually ${rateLabel(t.median)}`
  if (t.dropped) return `${rateLabel(t.grid ?? t.median)} fps with frames missing (as slow as ${rateLabel(t.min)} fps in places)`
  return `Constant ${rateLabel(t.grid ?? t.median)} fps`
}
