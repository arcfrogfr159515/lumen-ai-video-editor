import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { EFFORTS } from '@shared/ai'

// A window in Chinese.
vi.stubGlobal('localStorage', { getItem: (key: string) => (key === 'lumen.language' ? 'zh-CN' : null), setItem: () => {}, removeItem: () => {} })
vi.stubGlobal('requestAnimationFrame', () => 0)
vi.stubGlobal('cancelAnimationFrame', () => {})
vi.mock('sonner', () => ({ toast: Object.assign(() => {}, { error: () => {}, success: () => {}, loading: () => 1, dismiss: () => {} }) }))
// Drawn without a browser, a component reads a store as it was first made, whatever was put in it since. Here a
// store's hook reads the store as it is, so the picker can be drawn with a model that has levels.
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

const { language } = await import('@/lib/i18n')
const { useAi } = await import('@/integrations/ai')
const picker = await import('./EffortPicker')

describe('how hard the model thinks, in a window in Chinese', () => {
  it('shows the level that is set in Chinese', () => {
    expect(language).toBe('zh-CN')
    useAi.setState({
      target: { kind: 'model', provider: 'anthropic', model: 'claude-test', effort: 'high' },
      models: { anthropic: { models: [{ id: 'claude-test', name: 'Claude Test', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] }] } },
    })
    const html = renderToString(createElement(picker.EffortPicker))
    // The list of levels is shared with the main process and written in English: the button read “High”.
    expect(html).not.toMatch(/>High</)
    expect(html).toMatch(/>高</)
  })

  it('has a Chinese name and a Chinese line for every level', () => {
    expect(EFFORTS.map(picker.effortLabel)).toEqual(['低', '中', '高', '超高', '最高', '极限'])
    // Nothing of a line is left in English but the name of an agent.
    for (const effort of EFFORTS) expect(picker.effortHint(effort).replace(/Codex/g, ''), effort).not.toMatch(/[A-Za-z]/)
  })
})
