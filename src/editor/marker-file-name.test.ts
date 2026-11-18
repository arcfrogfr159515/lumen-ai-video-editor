import { describe, expect, it, vi } from 'vitest'

// The window speaks Chinese here. Its language is settled as the interface's modules load, from what the user chose.
vi.stubGlobal('localStorage', { getItem: (key: string) => (key === 'lumen.language' ? 'zh-CN' : null), setItem: () => {}, removeItem: () => {} })

const { language } = await import('@/lib/i18n')
const { markerFileName } = await import('./markers')

describe('the name offered for a file of exported markers', () => {
  it('says what the file holds in the window’s language', () => {
    expect(language).toBe('zh-CN')
    // The clip notes next to it are saved as "… 片段备注"; this name ended in the English word, written as it is.
    expect(markerFileName('旅行短片', 'youtube')).toBe('旅行短片 章节')
    for (const format of ['markdown', 'csv', 'json'] as const) expect(markerFileName('旅行短片', format)).toBe('旅行短片 标记')
  })
})
