import { describe, expect, it, vi } from 'vitest'

// The window speaks Chinese here. Its language is settled as the interface's modules load, from what the user chose.
vi.stubGlobal('localStorage', { getItem: (key: string) => (key === 'lumen.language' ? 'zh-CN' : null), setItem: () => {}, removeItem: () => {} })
vi.mock('sonner', () => ({ toast: Object.assign(() => {}, { error: () => {}, success: () => {} }) }))
// No model here: the subject's matte is one the test has put in the project.
vi.mock('./segment', () => ({ subjectMatte: async () => ({ assetId: 'matte', from: 0 }) }))

const { language } = await import('@/lib/i18n')
const { addAsset, freshProject, run } = await import('@/editor/test-helpers')
const { getProject, useEditor } = await import('@/editor/store')
const { textBehindSubject } = await import('./subject')

describe('text behind the subject', () => {
  it('names the tracks it makes in the window’s language', async () => {
    expect(language).toBe('zh-CN')
    freshProject('旅行短片')
    addAsset('footage', 10)
    addAsset('matte', 10, 'video', { matteOf: { assetId: 'footage', subject: 'person', from: 0, to: 300 } })
    // The footage is on a track above the titles: the title needs a track of its own above the footage.
    const top = run('track.add', { kind: 'video', name: 'B-roll', index: 0 }) as string
    const clipId = run('clip.add', { trackId: top, kind: 'video', start: 0, duration: 90, assetId: 'footage' }) as string
    const before = getProject().tracks.map((t) => t.id)

    const { subjectClipId, titleClipId } = await textBehindSubject(clipId, { text: '你好' })

    const p = getProject()
    const made = p.tracks.filter((t) => !before.includes(t.id)).map((t) => t.name)
    // The subject's track was "主体"; the title's, made a line earlier, was "Titles" — written as it is, not looked up.
    expect(made).toEqual(['主体', '标题'])
    // The stack, top down: the subject cut out, the title, the footage.
    const at = (id: string) => p.tracks.findIndex((t) => t.id === p.clips[id].trackId)
    expect([at(subjectClipId), at(titleClipId), at(clipId)]).toEqual([0, 1, 2])
    expect(p.clips[subjectClipId].matte).toEqual({ assetId: 'matte', from: 0 })
    // One undo step takes all of it back.
    useEditor.getState().undo()
    expect(getProject().tracks.map((t) => t.id)).toEqual(before)
  })
})
