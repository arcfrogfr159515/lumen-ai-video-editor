import { describe, expect, it } from 'vitest'
import { wrapDegrees } from './math'

describe('wrapDegrees', () => {
  it('brings an angle into (−180, 180]', () => {
    expect([0, 90, 180, 181, 270, 360, 450, 540].map(wrapDegrees)).toEqual([0, 90, 180, -179, -90, 0, 90, 180])
    expect([-90, -180, -181, -270, -360].map(wrapDegrees)).toEqual([-90, 180, 179, 90, 0])
  })

  it('comes back to where it began: two half turns (a mirror, and its undoing), four quarter turns', () => {
    const turn = (from: number, by: number, times: number) => Array.from({ length: times }).reduce<number>((angle) => wrapDegrees(angle + by), from)
    expect(turn(0, 180, 1)).toBe(180)
    expect(turn(0, 180, 2)).toBe(0)
    expect(turn(30, 180, 2)).toBe(30)
    expect(turn(0, 90, 3)).toBe(-90)
    expect(turn(0, 90, 4)).toBe(0)
  })
})
