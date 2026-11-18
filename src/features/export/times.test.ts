import { describe, expect, it } from 'vitest'
import { fmtEta, fmtTime } from './times'

describe('how long an export has left, or took', () => {
  it('is seconds, then minutes and seconds, then hours and minutes', () => {
    expect(fmtEta(0.2)).toBe('1s')
    expect(fmtEta(12.4)).toBe('12s')
    expect(fmtEta(90)).toBe('1m 30s')
    expect(fmtEta(3900)).toBe('1h 5m')
  })

  it('turns the minute and the hour over when what is left of them rounds up', () => {
    // 119.6 s used to read “1m 60s”, and 1 h 59.6 min “1h 60m”.
    expect(fmtEta(119.6)).toBe('2m 0s')
    expect(fmtEta(7176)).toBe('2h 0m')
    expect(fmtEta(3599.6)).toBe('1h 0m')
    expect(fmtEta(59.6)).toBe('1m 0s')
  })
})

describe('how long a render in the queue took', () => {
  it('is seconds, then minutes and seconds', () => {
    expect(fmtTime(0.2)).toBe('1s')
    expect(fmtTime(45)).toBe('45s')
    expect(fmtTime(4500)).toBe('75m 0s')
  })

  it('turns the minute over when the seconds round up to it', () => {
    expect(fmtTime(119.6)).toBe('2m 0s')
    expect(fmtTime(59.6)).toBe('1m 0s')
  })
})
