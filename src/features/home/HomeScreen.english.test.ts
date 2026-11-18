import { describe, expect, it, vi } from 'vitest'

// The window speaks English here because the user chose it — whatever language the computer the test runs on speaks.
vi.stubGlobal('localStorage', { getItem: (key: string) => (key === 'lumen.language' ? 'en' : null), setItem: () => {}, removeItem: () => {} })

const { language } = await import('@/lib/i18n')
const { timeAgo } = await import('./HomeScreen')

describe('when a project was last opened, on the home screen of a window in English', () => {
  it('is a date in English once it is more than a week ago', () => {
    expect(language).toBe('en')
    // Written in the computer's language, it read “2020年1月5日” on a Chinese computer, under “3 days ago” and “yesterday”.
    expect(timeAgo(new Date(2020, 0, 5, 12).getTime())).toBe('Jan 5, 2020')
  })
})
