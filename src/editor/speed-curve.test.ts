import { beforeEach, describe, expect, it } from 'vitest'
import { easeAt } from './easing'
import { curveAverage, curveLength, curvePoints, dragHandle, easingOf, footageCurve, handlePosition, handlesOf, insertPoint, movePoint, rampInput, removePoint, shapeSegment, speedOnCurve, type CurvePoint } from './speed-curve'
import { add, addAsset, clip, freshProject, run } from './test-helpers'
import { consumed } from './timing'

const ramp = (...pts: [number, number, CurvePoint['easing']?][]): CurvePoint[] => pts.map(([at, speed, easing]) => ({ at, speed, easing: easing ?? 'linear' }))

describe('a segment’s shape as handles', () => {
  it('reads cubic-beziers exactly, and a straight line as one', () => {
    expect(handlesOf('cubic-bezier(0.2, 0.9, 0.6, 1.4)')).toEqual([0.2, 0.9, 0.6, 1.4])
    expect(handlesOf('linear')).toEqual([0, 0, 1, 1])
    // x has to stay inside the segment for the curve to be a function of time.
    expect(handlesOf('cubic-bezier(-0.5, 0, 1.5, 1)')).toEqual([0, 0, 1, 1])
  })

  it('finds handles that follow a named curve closely', () => {
    for (const name of ['ease', 'ease-in', 'ease-out', 'sine-in-out', 'quad-out', 'cubic-in', 'circ-in-out', 'expo-out'] as const) {
      const curve = easingOf(handlesOf(name))
      for (const t of [0.1, 0.25, 0.4, 0.5, 0.6, 0.75, 0.9]) expect(Math.abs(easeAt(curve, t) - easeAt(name, t)), `${name} at ${t}`).toBeLessThan(0.035)
    }
    // The default curve — what a new ramp is made of — is followed almost exactly.
    for (const t of [0.2, 0.5, 0.8]) expect(Math.abs(easeAt(easingOf(handlesOf(undefined)), t) - easeAt('ease', t))).toBeLessThan(0.02)
  })

  it('writes handles back as a cubic-bezier, or as a straight line when that is what they draw', () => {
    expect(easingOf([0, 0, 1, 1])).toBe('linear')
    expect(easingOf([0.3, 0.3, 0.8, 0.8])).toBe('linear')
    expect(easingOf([0.3333, 0.5, 0.7, 1.25])).toBe('cubic-bezier(0.333, 0.5, 0.7, 1.25)')
    expect(easingOf([-1, 9, 2, -9])).toBe('cubic-bezier(0, 3, 1, -2)')
  })
})

describe('the curve', () => {
  it('gives the speed anywhere along the clip', () => {
    const pts = ramp([0, 1], [0.5, 3], [1, 3])
    expect(speedOnCurve(pts, 0)).toBe(1)
    expect(speedOnCurve(pts, 0.25)).toBeCloseTo(2)
    expect(speedOnCurve(pts, 0.75)).toBe(3)
    expect(speedOnCurve(pts, 2)).toBe(3)
    // A held segment stays at its speed until the next point.
    expect(speedOnCurve(ramp([0, 1, 'hold'], [0.5, 4]), 0.49)).toBe(1)
    // Overshooting handles can't take the clip outside the speeds it can play at.
    expect(speedOnCurve(ramp([0, 0.2, 'cubic-bezier(0.3, -2, 0.7, -2)'], [1, 1]), 0.5)).toBe(0.1)
  })

  it('decides the clip’s length from its average speed', () => {
    expect(curveAverage(ramp([0, 2], [1, 2]))).toBeCloseTo(2)
    expect(curveAverage(ramp([0, 1], [1, 3]))).toBeCloseTo(2, 2)
    // 600 frames of footage at an average of 2× is 300 frames of clip.
    expect(curveLength(ramp([0, 1], [1, 3]), 600)).toBe(300)
    expect(curveLength(ramp([0, 16], [1, 16]), 10)).toBe(2)
  })

  it('agrees with what the timeline does with the same ramp', () => {
    freshProject('Curve')
    addAsset('long', 60)
    const id = add('Overlay', 0, 300, { assetId: 'long' })
    const pts = ramp([0, 1, 'sine-in-out'], [0.4, 4, 'cubic-bezier(0.2, 0.8, 0.6, 1)'], [1, 0.5])
    const used = consumed(clip(id))
    run('clip.setSpeedRamp', { id, points: rampInput(pts) })
    expect(clip(id).duration).toBe(curveLength(pts, used))
    // The same footage plays, give or take the rounding of whole frames.
    expect(Math.abs(consumed(clip(id)) - used)).toBeLessThan(6)
    const back = curvePoints(clip(id))
    expect(back.map((p) => p.easing)).toEqual(pts.map((p) => p.easing))
    expect(back[1].at).toBeCloseTo(0.4, 2)
  })

  it('shows which part of the footage plays when', () => {
    const steady = footageCurve(ramp([0, 2], [1, 2]), 4)
    expect(steady.map((v) => Math.round(v * 100) / 100)).toEqual([0, 0.25, 0.5, 0.75, 1])
    // Fast first, slow after: most of the footage has gone by half way.
    const fastFirst = footageCurve(ramp([0, 4], [0.5, 4, 'hold'], [0.5 + 1e-9, 1], [1, 1]), 4)
    expect(fastFirst[2]).toBeCloseTo(0.8, 1)
    expect(fastFirst[4]).toBe(1)
    for (let i = 1; i < fastFirst.length; i++) expect(fastFirst[i]).toBeGreaterThan(fastFirst[i - 1])
  })

  it('reads a clip with no ramp as two points at its speed', () => {
    expect(curvePoints({ speed: 1.5, duration: 100, keyframes: {} })).toEqual([
      { at: 0, speed: 1.5, easing: 'ease' },
      { at: 1, speed: 1.5, easing: 'ease' },
    ])
  })
})

describe('editing the curve', () => {
  let pts: CurvePoint[]
  beforeEach(() => {
    pts = ramp([0, 1, 'cubic-bezier(0.42, 0, 0.58, 1)'], [0.5, 4], [1, 1])
  })

  it('moves points between their neighbours and keeps the ends at the edges', () => {
    expect(movePoint(pts, 1, 0.99, 2)[1]).toMatchObject({ at: 0.98, speed: 2 })
    expect(movePoint(pts, 1, -1, 99)[1]).toMatchObject({ at: 0.02, speed: 16 })
    expect(movePoint(pts, 0, 0.4, 0.01)[0]).toMatchObject({ at: 0, speed: 0.1 })
    expect(movePoint(pts, 2, 0.4, 2)[2].at).toBe(1)
  })

  it('adds a point on the curve without changing the speed there', () => {
    const next = insertPoint(pts, 0.25)!
    expect(next).toHaveLength(4)
    expect(next[1]).toMatchObject({ at: 0.25, easing: 'cubic-bezier(0.42, 0, 0.58, 1)' })
    expect(next[1].speed).toBeCloseTo(speedOnCurve(pts, 0.25), 2)
    expect(insertPoint(pts, 0.505)).toBeNull()
    expect(insertPoint(pts, 1.2)).toBeNull()
  })

  it('removes points but never an end', () => {
    expect(removePoint(pts, 1)).toHaveLength(2)
    expect(removePoint(pts, 0)).toHaveLength(3)
    expect(removePoint(pts, 2)).toHaveLength(3)
  })

  it('places a segment’s handles on the graph and reshapes it when one is dragged', () => {
    // Between (0, 1×) and (0.5, 4×): the first handle is 42% along at the first speed.
    expect(handlePosition(pts, 0, 0)).toEqual({ at: 0.21, speed: 1 })
    expect(handlePosition(pts, 0, 1)).toEqual({ at: 0.29, speed: 4 })
    const dragged = dragHandle(pts, 0, 0, 0.1, 2.5)
    expect(dragged[0].easing).toBe('cubic-bezier(0.2, 0.5, 0.58, 1)')
    expect(handlePosition(dragged, 0, 0)).toEqual({ at: 0.1, speed: 2.5 })
    // Dragged outside the segment, a handle stops at its edge.
    expect(dragHandle(pts, 0, 1, 0.9, 4)[0].easing).toBe('cubic-bezier(0.42, 0, 1, 1)')
    // Both handles on the diagonal: a straight line, and written as one.
    expect(dragHandle(dragHandle(pts, 0, 0, 0.1, 1.6), 0, 1, 0.4, 3.4)[0].easing).toBe('linear')
    // A held segment has no handles until it is given a shape again.
    const held = shapeSegment(pts, 0, 'hold')
    expect(handlePosition(held, 0, 0)).toBeNull()
    expect(dragHandle(held, 0, 0, 0.25, 1.6)[0].easing).toBe('cubic-bezier(0.5, 0.2, 1, 1)')
    expect(handlePosition(pts, 2, 0)).toBeNull()
  })

  it('keeps a handle’s height when the two speeds are the same', () => {
    const flat = ramp([0, 2, 'cubic-bezier(0.42, 0, 0.58, 1)'], [1, 2])
    expect(dragHandle(flat, 0, 0, 0.3, 9)[0].easing).toBe('cubic-bezier(0.3, 0, 0.58, 1)')
  })
})
