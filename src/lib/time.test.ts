import { describe, expect, it } from 'vitest'
import { formatTimecode, parseTimecode } from './time'

describe('a timecode typed into the ruler', () => {
  it('is read as seconds, minutes, hours and frames', () => {
    expect(parseTimecode('12', 30)).toBe(360)
    expect(parseTimecode('1:05', 30)).toBe(1950)
    expect(parseTimecode('01:00:00', 24)).toBe(86400)
    expect(parseTimecode('00:00:02:15', 30)).toBe(75)
    expect(parseTimecode(' 00;00;02;15 ', 30)).toBe(75)
    expect(parseTimecode(formatTimecode(1234, 30), 30)).toBe(1234)
    // A part left out counts as nothing, as it did: "1:" is a minute, ":30" half of one.
    expect(parseTimecode('1:', 30)).toBe(1800)
    expect(parseTimecode(':30', 30)).toBe(900)
  })

  it('is not a time when nothing was typed', () => {
    // An emptied field was read as 0: clearing the timecode and pressing Enter, or clicking away, sent the playhead
    // to the start of the timeline.
    expect(parseTimecode('', 30)).toBeNull()
    expect(parseTimecode('   ', 30)).toBeNull()
    expect(parseTimecode(':', 30)).toBeNull()
    expect(parseTimecode('::.', 30)).toBeNull()
  })

  it('is not a time when it isn’t made of numbers', () => {
    expect(parseTimecode('soon', 30)).toBeNull()
    expect(parseTimecode('1:x', 30)).toBeNull()
    expect(parseTimecode('-5', 30)).toBeNull()
  })
})
