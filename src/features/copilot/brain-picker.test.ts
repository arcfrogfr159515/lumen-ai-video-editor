import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// A window in Chinese.
vi.stubGlobal('localStorage', { getItem: (key: string) => (key === 'lumen.language' ? 'zh-CN' : null), setItem: () => {}, removeItem: () => {} })
vi.stubGlobal('requestAnimationFrame', () => 0)
vi.stubGlobal('cancelAnimationFrame', () => {})
vi.mock('sonner', () => ({ toast: Object.assign(() => {}, { error: () => {}, success: () => {}, loading: () => 1, dismiss: () => {} }) }))
// Drawn without a browser, a component reads a store as it was first made; here a store's hook reads it as it is.
vi.mock('zustand', async (original) => {
  const actual = await original<typeof import('zustand')>()
  const { createStore } = await import('zustand/vanilla')
  type Init = import('zustand/vanilla').StateCreator<unknown>
  const make = (init: Init) => {
    const store = createStore<unknown>(init)
    return Object.assign((selector?: (state: unknown) => unknown) => (selector ? selector(store.getState()) : store.getState()), store)
  }
  return { ...actual, create: (init?: Init) => (init ? make(init) : make) }
})
// And what opens — the picker's list — is drawn where it stands, open.
vi.mock('radix-ui', async () => {
  const { createElement: h } = await import('react')
  const Part = ({ children }: { children?: React.ReactNode }) => h('div', null, children)
  const parts = new Proxy({}, { get: (_, name) => (name === 'then' ? undefined : Part) })
  return { Dialog: parts, ContextMenu: parts, DropdownMenu: parts, Popover: parts, Select: parts, Slider: parts, Switch: parts, Tooltip: parts }
})

const { language } = await import('@/lib/i18n')
const { useAi } = await import('@/integrations/ai')
const { BrainPicker } = await import('./BrainPicker')

const blank = useAi.getState()
/** The words of the picker, one piece to a line. */
const shown = () => renderToString(createElement(BrainPicker)).replace(/<[^>]*>/g, '\n')

beforeEach(() => useAi.setState(blank, true))

describe('“Automatic” in the Copilot’s model picker, in a window in Chinese', () => {
  it('says which brain it uses when one is ready', () => {
    expect(language).toBe('zh-CN')
    useAi.setState({ localAgents: { 'claude-code': { id: 'claude-code', found: true, signedIn: true } } } as never)
    const words = shown()
    // Whether a brain is ready was told by the word “automatic” under its name — which is “自动” here, so the row
    // said “uses the first brain you connect” with one connected and in use.
    expect(words).not.toContain('使用你连接的第一个模型')
    expect(words).toContain('使用 Claude Code')
  })

  it('says it waits for one when none is', () => {
    const words = shown()
    expect(words).toContain('使用你连接的第一个模型')
    expect(words).not.toContain('使用 Claude Code')
  })
})
