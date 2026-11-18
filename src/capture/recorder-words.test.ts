import { describe, expect, it, vi } from 'vitest'

// A window in Chinese, and no desktop app behind it: only what the recorder says is looked at.
vi.stubGlobal('localStorage', { getItem: (key: string) => (key === 'lumen.language' ? 'zh-CN' : null), setItem: () => {}, removeItem: () => {} })
vi.mock('sonner', () => ({ toast: Object.assign(() => {}, { error: () => {}, success: () => {}, loading: () => 1, dismiss: () => {}, warning: () => {} }) }))
vi.mock('@/engine/decode', () => ({ probeMedia: async () => null }))
vi.mock('@/project/media-import', () => ({ analyzeAssets: async () => {} }))
vi.mock('@/lib/platform', () => ({ platform: { isMac: false }, desktop: undefined }))

const { language } = await import('@/lib/i18n')
const { recordedSummary } = await import('./recorder')

describe('what the recorder says when a recording ends, in a window in Chinese', () => {
  it('says where the clips went', () => {
    expect(language).toBe('zh-CN')
    expect(recordedSummary('Demo', 'timeline', 0)).toBe('Demo · 在时间线上')
    expect(recordedSummary('Demo', 'library', 0)).toBe('Demo · 在媒体库中')
  })

  it('says that the files were saved, when the clips went nowhere', () => {
    expect(recordedSummary('Demo', 'files', 0)).toBe('Demo · 已保存')
  })

  it('says how many things there were to know about it', () => {
    expect(recordedSummary('Demo', 'timeline', 1)).toBe('Demo · 在时间线上 · 1 条提示')
    expect(recordedSummary('Demo', 'library', 3)).toBe('Demo · 在媒体库中 · 3 条提示')
  })
})
