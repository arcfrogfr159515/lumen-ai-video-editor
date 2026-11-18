import { describe, expect, it, vi } from 'vitest'

// A window in Chinese.
vi.stubGlobal('localStorage', { getItem: (key: string) => (key === 'lumen.language' ? 'zh-CN' : null), setItem: () => {}, removeItem: () => {} })
const { language, tt } = await import('@/lib/i18n')
const { describeBatch } = await import('./batch')

describe('what a batch says it left alone, in a window in Chinese', () => {
  it('counts the clips in Chinese', () => {
    expect(language).toBe('zh-CN')
    const why = tt('no picture')
    expect(describeBatch({ changed: 2, skipped: [{ name: 'A', why }, { name: 'B', why }, { name: 'C', why }] })).toEqual({
      title: '已更改 2 个片段',
      description: `未更改：3 个片段 (${why})。`,
    })
  })

  it('names the one clip, when it is one', () => {
    const why = tt('no sound')
    expect(describeBatch({ changed: 0, skipped: [{ name: 'Title', why }] })).toEqual({ title: '没有任何更改', description: `未更改：“Title” (${why})。` })
  })
})
