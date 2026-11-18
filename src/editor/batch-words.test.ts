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

describe('why a batch change left a clip alone, in a window in Chinese', () => {
  it('is said in Chinese: a clip whose volume, opacity or size is keyframed', async () => {
    const { getProject } = await import('./store')
    const { addAsset, freshProject, run } = await import('./test-helpers')
    freshProject('批量')
    addAsset('shot', 20)
    const track = getProject().tracks.find((t) => t.kind === 'video' && !t.role)!
    const id = run('clip.add', { trackId: track.id, kind: 'video', assetId: 'shot', start: 0, duration: 60, name: '镜头' }) as string
    for (const prop of ['volume', 'opacity', 'scale'] as const) run('keyframe.set', { clipId: id, prop, frame: 0, value: 1 })
    type Result = { changed: number; skipped: { id: string; name: string; why: string }[] }
    const r = run('clip.batch', { ids: [id], volume: { mode: 'set', value: -6 }, opacity: 0.5, scale: { mode: 'set', value: 2 } }) as Result
    // The other reasons (“no sound”, “a freeze frame”…) were in Chinese; these three were written out in English.
    expect(r.skipped.map((s) => s.why)).toEqual(['音量带有关键帧——增减电平可以整体移动它', '不透明度带有关键帧', '缩放带有关键帧——按倍数缩放可以整体改变它'])
    expect(describeBatch(r).description).not.toMatch(/[a-z]{3}/i)
  })
})
