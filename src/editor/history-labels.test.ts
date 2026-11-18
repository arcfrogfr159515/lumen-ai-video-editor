import { beforeEach, describe, expect, it, vi } from 'vitest'

// The window speaks Chinese here. Its language is settled as the interface's modules load, from what the user chose.
vi.stubGlobal('localStorage', { getItem: (key: string) => (key === 'lumen.language' ? 'zh-CN' : null), setItem: () => {}, removeItem: () => {} })

const { language } = await import('@/lib/i18n')
const { addAsset, freshProject, run } = await import('./test-helpers')
const { getProject, useEditor } = await import('./store')

/** What the History — and Undo, in the title bar — calls the last edit. */
const lastStep = () => useEditor.getState().past.at(-1)?.label

let main = ''
/** A clip of the test's footage on the main track. */
const clip = (start: number, duration = 30) => run('clip.add', { trackId: main, kind: 'video', start, duration, assetId: 'footage' }) as string

beforeEach(() => {
  freshProject('旅行短片')
  addAsset('footage', 60)
  main = getProject().tracks.find((t) => t.role === 'main')!.id
})

describe('what the History calls an edit, in a Chinese window', () => {
  it('is Chinese', () => {
    expect(language).toBe('zh-CN')
    clip(0)
    expect(lastStep()).toBe('添加片段')
  })

  it('says a delete in one language', () => {
    // What was deleted was looked up and the verb was not: "Delete 片段", "Ripple delete 2 个片段".
    const [a, b, c] = [clip(0), clip(30), clip(60)]
    run('clip.delete', { ids: [a] })
    expect(lastStep()).toBe('删除 片段')
    run('clip.delete', { ids: [b, c], ripple: true })
    expect(lastStep()).toBe('波纹删除 2 个片段')
  })
})
