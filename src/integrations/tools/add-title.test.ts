import { describe, expect, it, vi } from 'vitest'

// The window speaks Chinese here. Its language is settled as the interface's modules load, from what the user chose.
vi.stubGlobal('localStorage', { getItem: (key: string) => (key === 'lumen.language' ? 'zh-CN' : null), setItem: () => {}, removeItem: () => {} })
vi.mock('sonner', () => ({ toast: Object.assign(() => {}, { error: () => {}, success: () => {}, loading: () => 1, dismiss: () => {} }) }))

const { language } = await import('@/lib/i18n')
const { freshProject, run } = await import('@/editor/test-helpers')
const { getProject, useEditor } = await import('@/editor/store')
const { CONTROL_TOOLS } = await import('./control')

const addTitle = CONTROL_TOOLS.find((t) => t.name === 'add_title')!

describe('a title the Copilot adds', () => {
  it('leaves the project with a track and a History step named in the window’s language', async () => {
    expect(language).toBe('zh-CN')
    freshProject('旅行短片')
    // Nowhere to put a title: the tracks that could take one are locked, so the tool makes a track for it.
    for (const t of getProject().tracks) if (t.kind === 'video' && t.role !== 'main') run('track.update', { id: t.id, patch: { locked: true } })
    const before = getProject().tracks.map((t) => t.id)

    const said = (await addTitle.run({ text: '你好，世界', at_seconds: 1 })) as { clip_id: string; track_id: string }

    const p = getProject()
    const made = p.tracks.filter((t) => !before.includes(t.id))
    // What the tool answers the model with stays English. What it leaves for the user to read was English too:
    // a track called "Titles" in the timeline, and "Title “…”" in the History.
    expect(made.map((t) => [t.name, t.role])).toEqual([['标题', 'titles']])
    expect(said.track_id).toBe(made[0].id)
    expect(p.clips[said.clip_id].text?.content).toBe('你好，世界')
    expect(useEditor.getState().past.at(-1)?.label).toBe('标题“你好，世界”')
  })

  it('uses the titles track that is there', async () => {
    freshProject('旅行短片')
    const tracks = getProject().tracks.length
    const said = (await addTitle.run({ text: 'Hello' })) as { track_id: string }
    expect(getProject().tracks).toHaveLength(tracks)
    expect(getProject().tracks.find((t) => t.id === said.track_id)?.role).toBe('titles')
  })
})
