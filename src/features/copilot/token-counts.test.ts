import { describe, expect, it } from 'vitest'
import { compact, usageLine } from './transcript'

describe('token counts as people read them', () => {
  it('are never a thousand thousands', () => {
    // Just under a million was rounded to the nearest thousand and then called thousands: "1000k".
    expect([compact(999_499), compact(999_500), compact(999_999), compact(1_000_000)]).toEqual(['999k', '1M', '1M', '1M'])
    expect(usageLine({ usage: { inputTokens: 999_800, outputTokens: 812 } })).toBe('1M tokens in · 812 out')
  })

  it('are as before everywhere else', () => {
    expect([999, 1000, 1234, 9949, 9999, 10_000, 34_500, 1_049_999, 1_050_000, 12_345_678].map(compact)).toEqual(['999', '1k', '1.2k', '9.9k', '10k', '10k', '35k', '1M', '1.1M', '12.3M'])
  })
})
