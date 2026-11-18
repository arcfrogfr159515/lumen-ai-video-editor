import { beforeEach, describe, expect, it, vi } from 'vitest'

// The window speaks Chinese here.
vi.stubGlobal('localStorage', { getItem: (key: string) => (key === 'lumen.language' ? 'zh-CN' : null), setItem: () => {}, removeItem: () => {} })

const { language } = await import('@/lib/i18n')
const { freshProject, run } = await import('./test-helpers')
const { getProject } = await import('./store')

beforeEach(() => freshProject('旅行短片'))

/** What the markers on the ruler are called, in the order they were added. */
const names = () => getProject().markers.map((m) => m.label)

describe('what a marker added without a name is called, in a Chinese window', () => {
  it('is Chinese, whatever kind it is', () => {
    expect(language).toBe('zh-CN')
    run('marker.add', { frame: 0, kind: 'chapter' })
    run('marker.add', { frame: 30, kind: 'todo' })
    run('marker.add', { frame: 60, kind: 'comment' })
    run('marker.add', { frame: 90 })
    // A to-do was the one kind whose name was put together as the code writes it: “To-do 1”.
    expect(names()).toEqual(['章节 1', '待办 1', '批注 1', '标记 4'])
  })

  it('counts to-dos among to-dos', () => {
    run('marker.add', { frame: 0, kind: 'chapter' })
    run('marker.add', { frame: 30, kind: 'todo' })
    run('marker.add', { frame: 60, kind: 'todo' })
    expect(names()).toEqual(['章节 1', '待办 1', '待办 2'])
  })
})
