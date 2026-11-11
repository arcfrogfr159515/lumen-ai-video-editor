import { describe, expect, it } from 'vitest'
import { constantRateFor, describeTiming, isUneven, isWhole, needsFullCheck, rateLabel, snapRate, timingFromMetrics, type RateMetrics } from './frame-rate'

describe('frame timing', () => {
  const constant: RateMetrics = { underlyingFrameRate: 30, minFrameRate: 30, maxFrameRate: 30, averageFrameRate: 30, medianFrameRate: 30, frameRateIsConstant: true, probedPacketCount: 256 }

  it('tells constant, dropped-frame and variable footage apart', () => {
    expect(timingFromMetrics(constant)).toEqual({ min: 30, max: 30, average: 30, median: 30, grid: 30, frames: 256 })
    const dropped = timingFromMetrics({ ...constant, frameRateIsConstant: false, minFrameRate: 10, averageFrameRate: 27.4 })!
    expect(dropped).toMatchObject({ dropped: true, grid: 30, min: 10 })
    expect(dropped.variable).toBeUndefined()
    const variable = timingFromMetrics({ underlyingFrameRate: null, minFrameRate: 14.2, maxFrameRate: 61.5, averageFrameRate: 28.71, medianFrameRate: 29.94, frameRateIsConstant: false, probedPacketCount: 256 })!
    expect(variable).toMatchObject({ variable: true, min: 14.2, max: 61.5, median: 29.94 })
    expect(variable.grid).toBeUndefined()
    expect(isUneven(timingFromMetrics(constant)!)).toBe(false)
    expect(isUneven(dropped)).toBe(true)
    expect(isUneven(variable)).toBe(true)
    expect(isUneven(undefined)).toBe(false)
  })

  it('does not judge a file by a handful of frames', () => {
    expect(timingFromMetrics({ ...constant, probedPacketCount: 5 })).toBeNull()
    expect(timingFromMetrics({ ...constant, medianFrameRate: Number.NaN })).toBeNull()
  })

  it('picks the constant rate a copy should have', () => {
    const t = (median: number, grid?: number) => ({ variable: grid === undefined, min: 10, max: 70, average: median - 1, median, ...(grid ? { grid } : {}), frames: 256 })
    // Usually the timeline's rate: use it exactly.
    expect(constantRateFor(t(29.94), 30)).toBe(30)
    // Twice the timeline's rate drops cleanly to it.
    expect(constantRateFor(t(59.7), 30)).toBe(60)
    // Otherwise the nearest rate cameras actually use.
    expect(constantRateFor(t(24.1), 30)).toBe(24)
    expect(constantRateFor(t(47.6), 30)).toBe(48)
    // Near the timeline's rate but on no camera's: it will be laid on the timeline's grid anyway.
    expect(constantRateFor(t(28.57), 30)).toBe(30)
    expect(constantRateFor(t(37), 30)).toBe(30)
    expect(constantRateFor(t(72), 30)).toBe(60)
    expect(constantRateFor(t(25, 25), 30)).toBe(25)
    expect(snapRate(29.97)).toBe(29.97)
    expect(snapRate(33)).toBeNull()
  })

  it('knows a quick look at the start from the whole file', () => {
    // What importing reads: the first 256 frames. Even so far — the rest is still to be read.
    const quick = timingFromMetrics(constant)!
    expect(isWhole(quick)).toBe(false)
    expect(needsFullCheck(quick)).toBe(true)
    expect(needsFullCheck(undefined)).toBe(true)
    // Read to the end, it is settled; so is a clip shorter than a quick look, and one already found uneven.
    const read = timingFromMetrics({ ...constant, probedPacketCount: 54000 }, true)!
    expect(read).toMatchObject({ whole: true, frames: 54000 })
    expect(needsFullCheck(read)).toBe(false)
    expect(needsFullCheck(timingFromMetrics({ ...constant, probedPacketCount: 90 })!)).toBe(false)
    expect(needsFullCheck(timingFromMetrics({ ...constant, frameRateIsConstant: false, minFrameRate: 10 })!)).toBe(false)
    // A project saved before this was told apart: its 256 frames are a quick look.
    expect(needsFullCheck({ min: 30, max: 30, average: 30, median: 30, grid: 30, frames: 256 })).toBe(true)
  })

  it('reads in a line', () => {
    expect(describeTiming(undefined)).toBe('Not checked yet')
    expect(describeTiming(timingFromMetrics(constant, true)!)).toBe('Constant 30 fps')
    expect(describeTiming(timingFromMetrics({ ...constant, probedPacketCount: 120 })!)).toBe('Constant 30 fps')
    // Only the start was read: it doesn't claim more than that.
    expect(describeTiming(timingFromMetrics(constant)!)).toBe('Constant 30 fps at the start — the rest isn’t checked yet')
    expect(describeTiming({ variable: true, min: 14.2, max: 61.5, average: 28.7, median: 29.97, frames: 256 })).toBe('Variable: 14.2–61.5 fps, usually 29.97')
    expect(describeTiming({ dropped: true, min: 10, max: 30, average: 27, median: 30, grid: 30, frames: 256 })).toBe('30 fps with frames missing (as slow as 10 fps in places)')
    expect(rateLabel(23.976)).toBe('23.976')
    expect(rateLabel(59.94)).toBe('59.94')
  })
})
