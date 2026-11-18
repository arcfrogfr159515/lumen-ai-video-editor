import { describe, expect, it } from 'vitest'
import { parseSubtitles } from './subtitles'

// Subtitle files as they are found, not as they should be: the line between two cues holding a space or a tab (a
// file gone through a word processor, a translation tool, a script that wrote " \n"), or not being there at all.

describe('a subtitle file whose cues aren’t parted by an empty line', () => {
  it('reads each cue when the line between them holds a space', () => {
    const srt = '1\n00:00:01,000 --> 00:00:02,000\nFirst\n \n2\n00:00:05,000 --> 00:00:07,000\nSecond\n \n3\n00:00:08,000 --> 00:00:09,000\nThird\n'
    // It was one cue: “First”, then the number and the times of the second as its next lines, and so on.
    expect(parseSubtitles(srt)).toEqual([
      { start: 1, end: 2, text: 'First' },
      { start: 5, end: 7, text: 'Second' },
      { start: 8, end: 9, text: 'Third' },
    ])
  })

  it('reads each cue when the line between them holds a tab, in a file from Windows', () => {
    const srt = '1\r\n00:00:01,000 --> 00:00:02,000\r\nFirst\r\n\t\r\n2\r\n00:00:05,000 --> 00:00:07,000\r\nSecond line one\r\nSecond line two\r\n'
    expect(parseSubtitles(srt)).toEqual([
      { start: 1, end: 2, text: 'First' },
      { start: 5, end: 7, text: 'Second line one\nSecond line two' },
    ])
  })

  it('reads each cue when nothing is between them', () => {
    const srt = '1\n00:00:01,000 --> 00:00:02,000\nFirst\n2\n00:00:05,000 --> 00:00:07,000\nSecond\n'
    expect(parseSubtitles(srt)).toEqual([
      { start: 1, end: 2, text: 'First' },
      { start: 5, end: 7, text: 'Second' },
    ])
  })

  it('reads WebVTT cues the same way', () => {
    const vtt = 'WEBVTT\n\n00:01.000 --> 00:02.000\nFirst\n \n00:05.000 --> 00:07.000 line:0\nSecond\n'
    expect(parseSubtitles(vtt)).toEqual([
      { start: 1, end: 2, text: 'First' },
      { start: 5, end: 7, text: 'Second' },
    ])
  })

  it('never shows another cue’s times as words', () => {
    const srt = '7\n00:00:01,000 --> 00:00:02,000\nFirst\n  \n8\n00:00:05,000 --> 00:00:07,000\nSecond\n'
    for (const cue of parseSubtitles(srt)) expect(cue.text).not.toMatch(/-->|^\d+$/m)
  })
})

describe('a cue’s own lines', () => {
  it('stay together across a line that holds only a space', () => {
    // Nothing after it says a new cue starts: it is a gap in this one's text, as it was.
    const srt = '1\n00:00:01,000 --> 00:00:02,000\nLine one\n \nLine two\n\n2\n00:00:05,000 --> 00:00:07,000\nSecond\n'
    expect(parseSubtitles(srt)).toEqual([
      { start: 1, end: 2, text: 'Line one\nLine two' },
      { start: 5, end: 7, text: 'Second' },
    ])
  })

  it('may be a number, or have an arrow in them', () => {
    const srt = '1\n00:00:01,000 --> 00:00:02,000\n42\n\n2\n00:00:05,000 --> 00:00:07,000\nA --> B\nat 00:00:06,000 --> or so\n1999\n'
    expect(parseSubtitles(srt)).toEqual([
      { start: 1, end: 2, text: '42' },
      { start: 5, end: 7, text: 'A --> B\nat 00:00:06,000 --> or so\n1999' },
    ])
  })
})
