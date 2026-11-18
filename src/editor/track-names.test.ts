import { beforeEach, describe, expect, it, vi } from 'vitest'

// A window in Chinese.
vi.stubGlobal('localStorage', { getItem: (key: string) => (key === 'lumen.language' ? 'zh-CN' : null), setItem: () => {}, removeItem: () => {} })
const { language } = await import('@/lib/i18n')
const { freshProject, run } = await import('./test-helpers')
const { getProject } = await import('./store')

const nameOf = (id: string) => getProject().tracks.find((t) => t.id === id)!.name

beforeEach(() => void freshProject('旅行短片'))

describe('a track added in a window in Chinese', () => {
  it('is named in Chinese, like the tracks a project starts with', () => {
    expect(language).toBe('zh-CN')
    // A new project has three video tracks and three audio tracks, named 标题, 叠加, 主视频, 人声, 音乐, 音效.
    expect(getProject().tracks.map((t) => t.name)).toContain('主视频')
    expect(nameOf(run('track.add', { kind: 'video' }) as string)).toBe('视频 4')
    expect(nameOf(run('track.add', { kind: 'audio' }) as string)).toBe('音频 4')
    expect(nameOf(run('track.add', { kind: 'video' }) as string)).toBe('视频 5')
  })

  it('keeps a name it is given', () => {
    expect(nameOf(run('track.add', { kind: 'video', name: 'B-roll' }) as string)).toBe('B-roll')
  })
})
