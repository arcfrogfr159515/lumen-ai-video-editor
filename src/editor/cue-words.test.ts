import { describe, expect, it, vi } from 'vitest'

// A window in Chinese.
vi.stubGlobal('localStorage', { getItem: (key: string) => (key === 'lumen.language' ? 'zh-CN' : null), setItem: () => {}, removeItem: () => {} })
const { language } = await import('@/lib/i18n')
const { cueText } = await import('./cues')

describe('what a cue says on a clip, in a window in Chinese', () => {
  it('is in Chinese where the words are Lumen’s own', () => {
    expect(language).toBe('zh-CN')
    // A cut already was.
    expect(cueText({ at: 0, kind: 'cut', label: 'Arrival' })).toBe('剪辑点：Arrival')
    // Somebody walking, with nobody named and with somebody.
    expect(cueText({ at: 1, kind: 'walk', label: 'walk' })).toBe('脚步声')
    expect(cueText({ at: 1, kind: 'walk', label: 'confident' })).toBe('脚步声 (confident)')
    expect(cueText({ at: 1, kind: 'walk', label: 'confident', who: 'Boss' })).toBe('Boss 行走 (confident)')
  })

  it('leaves what the sender wrote as it wrote it', () => {
    expect(cueText({ at: 2, kind: 'line', label: 'You are late.', who: 'Boss' })).toBe('Boss: You are late.')
    expect(cueText({ at: 3, kind: 'sfx', label: 'Door' })).toBe('Sfx: Door')
  })
})
