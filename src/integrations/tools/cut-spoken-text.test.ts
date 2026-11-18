import { beforeEach, describe, expect, it, vi } from 'vitest'

// The window speaks Chinese here. Its language is settled as the interface's modules load, from what the user chose.
vi.stubGlobal('localStorage', { getItem: (key: string) => (key === 'lumen.language' ? 'zh-CN' : null), setItem: () => {}, removeItem: () => {} })
vi.mock('sonner', () => ({ toast: Object.assign(() => {}, { error: () => {}, success: () => {}, loading: () => 1, dismiss: () => {} }) }))

const { language } = await import('@/lib/i18n')
const { addAsset, freshProject, run, transcript } = await import('@/editor/test-helpers')
const { getProject, useEditor } = await import('@/editor/store')
const { runAgentTool } = await import('../agent-tools')

const lastStep = () => useEditor.getState().past.at(-1)?.label

beforeEach(() => {
  freshProject('旅行短片')
  addAsset('talk', 20, 'audio', { transcript: transcript([1, 3, 'So um we drove up to the mountains'], [5, 7, 'The light was was perfect'], [9, 11, 'We drove home']) })
  const voice = getProject().tracks.find((t) => t.kind === 'audio')!.id
  run('clip.add', { trackId: voice, kind: 'audio', start: 0, duration: 600, assetId: 'talk' })
})

describe('words the Copilot cuts out of what is said', () => {
  it('are one step in the History, named in the window’s language', async () => {
    expect(language).toBe('zh-CN')
    const steps = useEditor.getState().past.length
    const res = await runAgentTool('cut_spoken_text', { phrases: ['up to the mountains'] })
    // What the tool answers the model stays English.
    expect(res.structuredContent).toMatchObject({ words_cut: 4, cuts: 1, text_cut: 'up to the mountains' })
    expect(useEditor.getState().past).toHaveLength(steps + 1)
    // The step's name is the user's to read: it was "Cut 4 spoken words", written as it is.
    expect(lastStep()).toBe('剪掉 4 个说出的词')
    await runAgentTool('cut_spoken_text', { word_indexes: [1] })
    expect(lastStep()).toBe('剪掉 1 个说出的词')
  })
})
