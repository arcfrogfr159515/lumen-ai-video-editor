import { describe, expect, it } from 'vitest'
import { formatDuration } from './time'

describe('a length written out', () => {
  it('is in tenths under ten seconds, whole seconds under a minute, minutes and hours after', () => {
    expect(formatDuration(0, 30)).toBe('0.0s')
    expect(formatDuration(135, 30)).toBe('4.5s')
    expect(formatDuration(298, 30)).toBe('9.9s')
    expect(formatDuration(300, 30)).toBe('10s')
    expect(formatDuration(1350, 30)).toBe('45s')
    expect(formatDuration(1784, 30)).toBe('59s')
    expect(formatDuration(1800, 30)).toBe('1:00')
    expect(formatDuration(1950, 30)).toBe('1:05')
    expect(formatDuration(111690, 30)).toBe('1:02:03')
  })

  it('reads ten seconds one way, a frame short of them or not', () => {
    // 299 frames at 30 a second are 9.97 s. To a tenth that is ten seconds, and was written "10.0s" — beside the
    // "10s" of the frame after.
    expect(formatDuration(299, 30)).toBe('10s')
    expect(formatDuration(599, 60)).toBe('10s')
    expect(formatDuration(239, 24)).toBe('10s')
  })

  it('reads a minute as a minute, half a second short of it or not', () => {
    // From 59.5 s on, the whole seconds are sixty: "60s", beside the "1:00" of the minute itself.
    expect(formatDuration(1785, 30)).toBe('1:00')
    expect(formatDuration(1799, 30)).toBe('1:00')
    expect(formatDuration(3599, 60)).toBe('1:00')
  })

  it('never writes sixty seconds, or ten of them to a tenth, at any length', () => {
    const odd: string[] = []
    for (const fps of [24, 25, 30, 50, 60]) {
      for (let frames = 0; frames <= fps * 3700; frames++) {
        const text = formatDuration(frames, fps)
        if (!/^(?:\d\.\d|[1-5]\d)s$|^(?:[1-9]|[1-5]\d):[0-5]\d$|^\d+:[0-5]\d:[0-5]\d$/.test(text)) odd.push(`${frames} @ ${fps}: ${text}`)
      }
    }
    expect(odd).toEqual([])
  })
})
