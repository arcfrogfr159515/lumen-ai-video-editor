import { describe, expect, it, vi } from 'vitest'

// The window speaks Chinese here. Its language is settled as the interface's modules load, from what the user chose.
vi.stubGlobal('localStorage', { getItem: (key: string) => (key === 'lumen.language' ? 'zh-CN' : null), setItem: () => {}, removeItem: () => {} })

const { language } = await import('@/lib/i18n')
const { timeAgo } = await import('./HomeScreen')

const HOUR = 3_600_000

describe('how long ago a project was opened, on the home screen', () => {
  it('is said in the window’s language, however long ago it was', () => {
    expect(language).toBe('zh-CN')
    const now = Date.now()
    // "yesterday" was written as it is, not looked up: it stayed English in a list that was otherwise Chinese.
    expect(timeAgo(now - 30 * HOUR)).toBe('昨天')
    for (const ago of [5_000, 5 * 60_000, 3 * HOUR, 30 * HOUR, 3 * 24 * HOUR, 6.5 * 24 * HOUR]) expect(timeAgo(now - ago), `${ago / HOUR} h ago`).not.toMatch(/[a-z]/i)
    expect(timeAgo(now - 3 * 24 * HOUR)).toBe('3 天前')
  })
})
