import { describe, expect, it, vi } from 'vitest'

// A window in Chinese.
vi.stubGlobal('localStorage', { getItem: (key: string) => (key === 'lumen.language' ? 'zh-CN' : null), setItem: () => {}, removeItem: () => {} })
const { language } = await import('@/lib/i18n')
const { optionName } = await import('./option-names')

describe('the options of a 3D background, in a window in Chinese', () => {
  it('names each set of colours in Chinese', () => {
    expect(['aurora', 'sunset', 'candy', 'ocean', 'mono'].map((palette) => optionName('palette', palette))).toEqual(['极光', '日落', '糖果', '海洋', '单色'])
  })

  it('names each kind of form in Chinese', () => {
    expect(['mix', 'blobs', 'rings', 'cubes'].map((form) => optionName('form', form))).toEqual(['混合', '团块', '圆环', '立方体'])
  })
})

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
