import { describe, expect, it, vi } from 'vitest'

// The window speaks Chinese here. Its language is settled as the interface's modules load, from what the user chose.
vi.stubGlobal('localStorage', { getItem: (key: string) => (key === 'lumen.language' ? 'zh-CN' : null), setItem: () => {}, removeItem: () => {} })

const { language } = await import('@/lib/i18n')
const { addAsset, freshProject, run } = await import('./test-helpers')
const { getProject } = await import('./store')
const { chapters, exportMarkers } = await import('./markers')
const { storyboard } = await import('./storyboard')

describe('what plays before the first chapter', () => {
  it('is a section with a name in the window’s language', () => {
    expect(language).toBe('zh-CN')
    freshProject('旅行短片')
    addAsset('footage', 120)
    const main = getProject().tracks.find((t) => t.role === 'main')!.id
    run('clip.add', { trackId: main, kind: 'video', start: 0, duration: 1800, assetId: 'footage' })
    for (const [frame, label] of [[450, '出发'], [900, '山路'], [1350, '日落']] as const) run('marker.add', { frame, label, kind: 'chapter' })

    // The stretch before the first chapter has no marker to take a name from. Its name was English as written:
    // "Opening" over the first cards of the storyboard, "Intro" at the top of the chapter list for a video site.
    expect(chapters(getProject()).map((c) => c.title)).toEqual(['开场', '出发', '山路', '日落'])
    expect(storyboard(getProject()).map((s) => s.title)).toEqual(['开场', '出发', '山路', '日落'])
    expect(exportMarkers(getProject(), 'youtube').text).toBe('0:00 片头\n0:15 出发\n0:30 山路\n0:45 日落\n')
  })
})
