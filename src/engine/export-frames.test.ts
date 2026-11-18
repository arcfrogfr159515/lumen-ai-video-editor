import { beforeEach, describe, expect, it, vi } from 'vitest'

// What an export draws for each of its frames is what the compositor draws at a frame of the timeline. Which frame
// that is, is worked out here — and at a cut, a frame that comes out a hair short is the clip before the cut.

// The transport runs on animation frames and the audio engine, which only a browser has.
vi.mock('@/editor/playback', () => ({ playback: { pause: () => {}, seek: () => {} }, usePlayback: Object.assign(() => 0, { getState: () => ({ frame: 0, playing: false }), subscribe: () => () => {} }) }))

const { timelineFrameAt } = await import('./export-frames')
const { clipsDrawnAt } = await import('./compositor')
const { add, addAsset, freshProject } = await import('@/editor/test-helpers')
const { dispatch, getProject } = await import('@/editor/store')

const RATES = [12, 24, 25, 30, 48, 50, 60, 120]

describe('the timeline frame an export frame shows', () => {
  it('is that very frame when the export runs at the timeline’s rate', () => {
    const off: string[] = []
    for (const fps of RATES) for (let i = 0; i <= 20_000; i++) if (timelineFrameAt(i, fps, fps) !== i) off.push(`${i} @ ${fps}: ${timelineFrameAt(i, fps, fps)}`)
    // 29 at 25 a second came out 28.999999999999996, 123 at 30 came out 122.99999999999999: one frame in twenty at
    // 25 and 50, one in sixty at 30 and 60.
    expect(off.slice(0, 5)).toEqual([])
    expect(off).toHaveLength(0)
  })

  it('counts on from where the export starts', () => {
    expect(timelineFrameAt(0, 25, 25, 1000)).toBe(1000)
    expect(timelineFrameAt(29, 25, 25, 1000)).toBe(1029)
    expect(timelineFrameAt(123, 30, 30, 77)).toBe(200)
  })

  it('is a whole frame wherever two different rates meet on one, and between two frames where they don’t', () => {
    const off: string[] = []
    for (const fps of RATES) {
      for (const timelineFps of RATES) {
        for (let i = 0; i <= 3000; i++) {
          const got = timelineFrameAt(i, fps, timelineFps)
          const whole = (i * timelineFps) % fps === 0
          if (whole ? got !== (i * timelineFps) / fps : Math.abs(got - (i * timelineFps) / fps) > 1e-9 || Number.isInteger(got)) off.push(`${i}: ${timelineFps} → ${fps}: ${got}`)
        }
      }
    }
    expect(off.slice(0, 5)).toEqual([])
    // Half-way between two frames of a timeline at 30 exported at 60, and every other frame of one at 60 exported at 30.
    expect(timelineFrameAt(1, 60, 30)).toBe(0.5)
    expect(timelineFrameAt(7, 30, 60)).toBe(14)
    expect(timelineFrameAt(6, 30, 25)).toBe(5)
  })
})

describe('an export’s frame at a cut', () => {
  beforeEach(() => {
    freshProject('Cuts')
    addAsset('a', 600)
    addAsset('b', 600)
  })

  /** Two clips that meet at `cut`, on a timeline at `fps`: which one the export's frame `index` draws, and how far into it. */
  const drawnAt = (fps: number, cut: number, index: number) => {
    freshProject('Cuts')
    dispatch('project.update', { settings: { fps } })
    addAsset('a', 600)
    addAsset('b', 600)
    add('Main', 0, cut, { assetId: 'a', name: 'before' })
    add('Main', cut, 100, { assetId: 'b', name: 'after' })
    const [top] = clipsDrawnAt(getProject(), timelineFrameAt(index, fps, fps))
    return `${top.clip.name} @ ${top.local}`
  }

  it('is the first frame of the clip after it', () => {
    // The thirtieth frame of an export at 25 a second showed the clip before the cut once more — a frame of footage
    // from past where that clip had been trimmed — and the clip after it came in a frame late.
    expect(drawnAt(25, 29, 29)).toBe('after @ 0')
    expect(drawnAt(25, 29, 28)).toBe('before @ 28')
    expect(drawnAt(30, 123, 123)).toBe('after @ 0')
    expect(drawnAt(50, 57, 57)).toBe('after @ 0')
    expect(drawnAt(60, 245, 245)).toBe('after @ 0')
  })

  it('is, wherever the cut falls', () => {
    const late: string[] = []
    for (const fps of [25, 30]) for (let cut = 1; cut <= 400; cut++) if (drawnAt(fps, cut, cut) !== 'after @ 0') late.push(`${cut} @ ${fps}: ${drawnAt(fps, cut, cut)}`)
    expect(late).toEqual([])
  })
})
