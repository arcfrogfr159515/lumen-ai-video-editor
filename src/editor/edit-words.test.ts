import { describe, expect, it, vi } from 'vitest'

// A window in Chinese.
vi.stubGlobal('localStorage', { getItem: (key: string) => (key === 'lumen.language' ? 'zh-CN' : null), setItem: () => {}, removeItem: () => {} })
const { language } = await import('@/lib/i18n')
const { describeEdit, resolveEdit } = await import('./three-point')

const base = { playhead: 500, sourceLength: 900 }
const tc = (f: number) => `f${f}`

describe('what an edit from the source monitor says it will do, in a window in Chinese', () => {
  it('is in Chinese all the way through', () => {
    expect(language).toBe('zh-CN')
    expect(describeEdit(resolveEdit({ ...base, sourceIn: 100, sourceOut: 250, timelineOut: 400 }, 30), 30, tc)).toBe('三点编辑：5 s，位于 f250 · 从出点倒推')
    expect(describeEdit(resolveEdit({ ...base, sourceIn: 100, sourceOut: 280, timelineIn: 300, timelineOut: 360 }, 30, 'fit'), 30, tc)).toBe('四点编辑：2 s，位于 f300 · 以 3× 速度适配')
    expect(describeEdit(resolveEdit(base, 30), 30, tc)).toBe('在播放头处：30 s，位于 f500')
  })

  it('names an edit of one or two points in Chinese too', () => {
    expect(describeEdit(resolveEdit({ ...base, sourceIn: 100, sourceOut: 250 }, 30), 30, tc)).toBe('2 点编辑：5 s，位于 f500')
    expect(describeEdit(resolveEdit({ ...base, sourceIn: 870 }, 30), 30, tc)).toBe('1 点编辑：1 s，位于 f500')
  })
})
