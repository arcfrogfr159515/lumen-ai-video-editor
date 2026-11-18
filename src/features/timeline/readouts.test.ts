import { describe, expect, it, vi } from 'vitest'

// The window speaks Chinese here. Its language is settled as the interface's modules load, from what the user chose.
vi.stubGlobal('localStorage', { getItem: (key: string) => (key === 'lumen.language' ? 'zh-CN' : null), setItem: () => {}, removeItem: () => {} })

const { language } = await import('@/lib/i18n')
const { dropReadout, fadeReadout, trimReadout } = await import('./readouts')

describe('the readout beside the pointer while dragging in the timeline', () => {
  it('is in the window’s language', () => {
    expect(language).toBe('zh-CN')
    // These three were put together from English words as they are written, not looked up: in a Chinese window a
    // trim said "ripple", a drop with Shift held "Overwrite at", a fade "Fade in".
    expect(dropReadout('insert', '00:00:02:00')).toBe('插入到 00:00:02:00')
    expect(dropReadout('overwrite', '00:00:02:00')).toBe('覆盖到 00:00:02:00')
    expect(trimReadout('4.5s', true, '00:00:02:00')).toBe('4.5s  ·  波纹')
    expect(trimReadout('4.5s', false, '00:00:02:00')).toBe('4.5s  ·  00:00:02:00  ·  Ctrl 波纹')
    expect(fadeReadout('fadeIn', '0.5s')).toBe('淡入  0.5s')
    expect(fadeReadout('fadeOut', '1.2s')).toBe('淡出  1.2s')
  })
})
