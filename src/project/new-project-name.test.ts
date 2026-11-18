import { describe, expect, it, vi } from 'vitest'

// The window speaks Chinese here. Its language is settled as the interface's modules load, from what the user chose.
vi.stubGlobal('localStorage', { getItem: (key: string) => (key === 'lumen.language' ? 'zh-CN' : null), setItem: () => {}, removeItem: () => {} })
vi.mock('sonner', () => ({ toast: Object.assign(() => {}, { error: () => {}, success: () => {}, loading: () => 1, dismiss: () => {}, warning: () => {} }) }))
// Opening a project stops playback, which is a browser's to stop.
vi.stubGlobal('cancelAnimationFrame', () => {})
vi.stubGlobal('requestAnimationFrame', () => 0)

const { language } = await import('@/lib/i18n')
const { createEmptyProject } = await import('@/editor/new-project')
const { checkProject } = await import('@/editor/project-check')
const { getProject } = await import('@/editor/store')
const { newProject } = await import('./session')

describe('a project that has not been given a name', () => {
  it('is called “untitled” in the window’s language', async () => {
    expect(language).toBe('zh-CN')
    // The name is in the title bar, and is the file name Save offers. It was "Untitled", written as it is, whatever
    // the window speaks — the dictionary has had the word all along, for a file that has no name.
    expect(getProject().name).toBe('未命名')
    expect(createEmptyProject().name).toBe('未命名')
    expect(await newProject({ width: 1080, height: 1920, fps: 30 })).toBe(true)
    expect(getProject()).toMatchObject({ name: '未命名', settings: { width: 1080, height: 1920, fps: 30 } })
    // A file that holds a project and no name for it.
    const { name: _name, ...nameless } = createEmptyProject('片子')
    expect(checkProject(JSON.parse(JSON.stringify(nameless))).project.name).toBe('未命名')
  })

  it('keeps the name it is given', async () => {
    expect(createEmptyProject('旅行短片').name).toBe('旅行短片')
    expect(await newProject({}, 'Road trip')).toBe(true)
    expect(getProject().name).toBe('Road trip')
  })
})
