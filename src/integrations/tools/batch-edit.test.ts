import { beforeEach, describe, expect, it, vi } from 'vitest'

// The window speaks Chinese here. Its language is settled as the interface's modules load, from what the user chose.
vi.stubGlobal('localStorage', { getItem: (key: string) => (key === 'lumen.language' ? 'zh-CN' : null), setItem: () => {}, removeItem: () => {} })
vi.mock('sonner', () => ({ toast: Object.assign(() => {}, { error: () => {}, success: () => {}, loading: () => 1, dismiss: () => {} }) }))

const { language } = await import('@/lib/i18n')
const { addAsset, freshProject } = await import('@/editor/test-helpers')
const { getProject, useEditor } = await import('@/editor/store')
const { CONTROL_TOOLS } = await import('./control')

const batchEdit = CONTROL_TOOLS.find((t) => t.name === 'batch_edit')!
const lastStep = () => useEditor.getState().past.at(-1)?.label

let main = ''
const twoClips = () => [
  { command: 'clip_add', input: { trackId: main, kind: 'video', start: 0, duration: 30, assetId: 'footage' } },
  { command: 'clip.add', input: { trackId: main, kind: 'video', start: 30, duration: 30, assetId: 'footage' } },
]

beforeEach(() => {
  freshProject('旅行短片')
  addAsset('footage', 60)
  main = getProject().tracks.find((t) => t.role === 'main')!.id
})

describe('a batch of edits by the Copilot', () => {
  it('is one step in the History, named in the window’s language when the Copilot gives it no name', async () => {
    expect(language).toBe('zh-CN')
    const steps = useEditor.getState().past.length
    const said = (await batchEdit.run({ commands: twoClips() })) as { applied: number; failed: number }
    expect(said).toMatchObject({ applied: 2, failed: 0 })
    expect(useEditor.getState().past).toHaveLength(steps + 1)
    // The name was English as written: "AI edit (2 steps)" in a History that is otherwise Chinese.
    expect(lastStep()).toBe('AI 编辑（2 步）')
  })

  it('keeps the name the Copilot gives it', async () => {
    await batchEdit.run({ commands: twoClips(), label: '开场两个镜头' })
    expect(lastStep()).toBe('开场两个镜头')
  })

  it('changes nothing when one of its edits is refused', async () => {
    const before = getProject()
    const steps = useEditor.getState().past.length
    await expect(batchEdit.run({ commands: [...twoClips(), { command: 'clip_delete', input: { ids: ['no-such-clip'] } }] })).rejects.toThrow(/Step 3/)
    expect(getProject()).toEqual(before)
    expect(useEditor.getState().past).toHaveLength(steps)
  })
})
