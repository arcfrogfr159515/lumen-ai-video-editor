import { describe, expect, it, vi } from 'vitest'

// A window in Chinese.
vi.stubGlobal('localStorage', { getItem: (key: string) => (key === 'lumen.language' ? 'zh-CN' : null), setItem: () => {}, removeItem: () => {} })
const { language } = await import('@/lib/i18n')
const { optionName } = await import('./option-names')

describe('the options of a motion graphic, in a window in Chinese', () => {
  it('names the side it is aligned to in Chinese', () => {
    expect(language).toBe('zh-CN')
    expect(['left', 'right'].map((side) => optionName('side', side))).toEqual(['左', '右'])
  })

  it('names each look in Chinese', () => {
    // The looks of a lower third, a title card and kinetic type, as GenerateMotion lists them.
    expect(['editorial', 'block', 'minimal', 'poster', 'punch', 'stack', 'stretch'].map((style) => optionName('style', style))).toEqual(['杂志风', '色块', '极简', '海报', '冲击', '堆叠', '拉伸'])
  })
})
