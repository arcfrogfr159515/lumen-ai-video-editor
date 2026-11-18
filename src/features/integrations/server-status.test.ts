import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { McpServerState, McpStatus } from '@shared/integrations'

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
// And what opens — the Integrations window — is drawn where it stands, open.
vi.mock('radix-ui', async () => {
  const { createElement: h } = await import('react')
  const Part = ({ children }: { children?: React.ReactNode }) => h('div', null, children)
  const parts = new Proxy({}, { get: (_, name) => (name === 'then' ? undefined : Part) })
  return { Dialog: parts, ContextMenu: parts, DropdownMenu: parts, Popover: parts, Select: parts, Slider: parts, Switch: parts, Tooltip: parts }
})

const { language } = await import('@/lib/i18n')
const { useIntegrations } = await import('@/integrations/store')
const { IntegrationsHub } = await import('./IntegrationsHub')
const { STATUS_LABEL } = await import('./parts')

const server = (id: string, name: string, status: McpStatus): McpServerState => ({ config: { id, name, transport: 'http', url: `https://${id}.example/mcp`, enabled: true }, status, tools: [] })

describe('how a server of the Integrations window is getting on, in a window in Chinese', () => {
  it('has a Chinese word for every state a server can be in', () => {
    expect(language).toBe('zh-CN')
    // Of the five, “Connecting…” was the one written as it is and not looked up.
    expect(STATUS_LABEL).toEqual({ connected: '已连接', connecting: '正在连接…', 'needs-auth': '正在等待登录', error: '错误', disconnected: '未连接' })
  })

  it('says a server is connecting in Chinese, in the list of servers', () => {
    useIntegrations.setState({ hubOpen: true, servers: { one: server('one', '演示服务器', 'connecting'), two: server('two', '另一个', 'disconnected') } })
    const shown = renderToString(createElement(IntegrationsHub)).replace(/<[^>]*>/g, '\n')
    expect(shown).toContain('演示服务器')
    expect(shown).not.toContain('Connecting…')
    expect(shown).toContain('正在连接…')
  })
})
