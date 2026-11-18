import { describe, expect, it, vi } from 'vitest'

// A window in Chinese.
vi.stubGlobal('localStorage', { getItem: (key: string) => (key === 'lumen.language' ? 'zh-CN' : null), setItem: () => {}, removeItem: () => {} })
vi.mock('sonner', () => ({ toast: Object.assign(() => {}, { error: () => {}, success: () => {}, loading: () => 1, dismiss: () => {} }) }))

const { language } = await import('@/lib/i18n')
const { toolDefinitions } = await import('@/editor/commands')
const { agentTools } = await import('@/integrations/agent-tools')
const { toolTitle } = await import('./transcript')

/** The editing commands a model can call by name (clip_split, marker_add…): tools too, but not the ones meant here. */
const editing = new Set(toolDefinitions().map((d) => d.name))

describe('what a step of the Copilot’s reply is called, in a window in Chinese', () => {
  it('has a Chinese name for each of the editor’s own tools', () => {
    expect(language).toBe('zh-CN')
    const tools = agentTools({})
      .map((t) => t.name)
      .filter((name) => !editing.has(name))
    expect(tools.length).toBeGreaterThan(80)
    // A step is named from a table, looked up; a tool that isn't in it is named by the English words of its own
    // name — “Find gaps”, “List timelines”, “Get storyboard” — and eighteen of the tools added since weren't.
    expect(tools.filter((name) => !/[\u4e00-\u9fff]/.test(toolTitle(name)))).toEqual([])
  })

  it('still makes a name of a tool’s own words when the tool is a server’s', () => {
    expect(toolTitle('mcp__studio__film_take')).toBe('Film take')
  })
})
