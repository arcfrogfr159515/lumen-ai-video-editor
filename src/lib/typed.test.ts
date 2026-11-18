import { describe, expect, it } from 'vitest'
import { parseTimecode } from './time'
import { typedNumber } from './typed'

describe('a time typed with a Chinese or Japanese input method on', () => {
  it('is read with its own colon and full stop, and with full-width digits', () => {
    // The input method types ： for the colon key and 。 for the full stop — and １２３ in full-width mode. None of
    // them is the character that was looked for: "1：30" was no time at all, and the field went back to what it showed.
    expect(parseTimecode('1：30', 30)).toBe(2700)
    expect(parseTimecode('１：３０', 30)).toBe(2700)
    expect(parseTimecode('00：00：02：15', 30)).toBe(75)
    expect(parseTimecode('00；00；02；15', 30)).toBe(75)
    expect(parseTimecode('1。05', 30)).toBe(1950)
  })

  it('is read as before when it is typed in English', () => {
    expect(parseTimecode('12', 30)).toBe(360)
    expect(parseTimecode('1:05', 30)).toBe(1950)
    expect(parseTimecode('00:00:02:15', 30)).toBe(75)
    expect(parseTimecode('', 30)).toBeNull()
    expect(parseTimecode('soon', 30)).toBeNull()
  })
})

describe('a number typed into a field', () => {
  it('is read with the input method’s full stop and full-width digits', () => {
    // Everything that isn't a digit, a point or a sign was thrown away and what was left was the number: "1。5" was
    // 15, and "１２" — nothing left of it — was 0.
    expect(typedNumber('1。5')).toBe(1.5)
    expect(typedNumber('１２')).toBe(12)
    expect(typedNumber('１．５')).toBe(1.5)
    expect(typedNumber('－３')).toBe(-3)
    expect(typedNumber('５０％')).toBe(50)
  })

  it('is read as before with its unit beside it, or a sign before it', () => {
    expect(typedNumber('50%')).toBe(50)
    expect(typedNumber('10 px')).toBe(10)
    expect(typedNumber('-3.5')).toBe(-3.5)
    expect(typedNumber('+2')).toBe(2)
    expect(typedNumber(' 1.25 ')).toBe(1.25)
    expect(typedNumber('0')).toBe(0)
  })

  it('is no number when nothing of it is one', () => {
    // (What is no number leaves the field as it was: it was taken for 0.)
    expect(typedNumber('')).toBeNull()
    expect(typedNumber('   ')).toBeNull()
    expect(typedNumber('px')).toBeNull()
    expect(typedNumber('1.2.3')).toBeNull()
    expect(typedNumber('-')).toBeNull()
  })
})
