import { describe, expect, it, vi } from 'vitest'

// A window in Chinese.
vi.stubGlobal('localStorage', { getItem: (key: string) => (key === 'lumen.language' ? 'zh-CN' : null), setItem: () => {}, removeItem: () => {} })
vi.mock('sonner', () => ({ toast: Object.assign(() => {}, { error: () => {}, success: () => {}, loading: () => 1, dismiss: () => {} }) }))

const { language } = await import('@/lib/i18n')
const { toolDefinitions } = await import('@/editor/commands')
const { agentTools } = await import('@/integrations/agent-tools')
const { toolTitle } = await import('./transcript')

/** The editing commands a model can call by name (clip_split, marker_add…). */
const editing = new Set(toolDefinitions().map((d) => d.name))
/** The tools whose step would be named in English. */
const english = (names: string[]) => names.filter((name) => !/[\u4e00-\u9fff]/.test(toolTitle(name)))

describe('what a step of the Copilot’s reply is called, in a window in Chinese', () => {
  it('has a Chinese name for each of the editor’s own tools', () => {
    expect(language).toBe('zh-CN')
    const tools = agentTools({})
      .map((t) => t.name)
      .filter((name) => !editing.has(name))
    expect(tools.length).toBeGreaterThan(80)
    // A step is named from a table, looked up; a tool that isn't in it is named by the English words of its own
    // name — “Find gaps”, “List timelines”, “Get storyboard” — and eighteen of the tools added since weren't.
    expect(english(tools)).toEqual([])
  })

  it('has a Chinese name for each editing command a model calls by name', () => {
    expect(editing.size).toBeGreaterThan(60)
    // None of them was in the table but one: “Clip split”, “Marker add”, “Timeline remove range”.
    expect(english([...editing])).toEqual([])
    expect(toolTitle('clip_split')).toBe('分割')
    expect(toolTitle('marker_add')).toBe('添加标记')
    expect(toolTitle('timeline_removeRange')).toBe('移除范围')
  })

  it('still makes a name of a tool’s own words when the tool is a server’s', () => {
    expect(toolTitle('mcp__studio__film_take')).toBe('Film take')
  })
})
