import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { PROVIDERS } from '@shared/ai'

// A window in Chinese, with no desktop app behind it: the pane is drawn as it is before anything is connected.
vi.stubGlobal('localStorage', { getItem: (key: string) => (key === 'lumen.language' ? 'zh-CN' : null), setItem: () => {}, removeItem: () => {} })
vi.stubGlobal('requestAnimationFrame', () => 0)
vi.stubGlobal('cancelAnimationFrame', () => {})
vi.mock('sonner', () => ({ toast: Object.assign(() => {}, { error: () => {}, success: () => {}, loading: () => 1, dismiss: () => {} }) }))

const { language } = await import('@/lib/i18n')
const { ModelsPane } = await import('./AiPanes')

describe('the AI models pane, in a window in Chinese', () => {
  const html = renderToString(createElement(ModelsPane)).replace(/&amp;/g, '&')

  it('says what each provider is in Chinese', () => {
    expect(language).toBe('zh-CN')
    // Each provider's line was shown as the list of providers has it, which is written in English.
    for (const spec of PROVIDERS) expect(html, spec.id).not.toContain(`>${spec.tagline}<`)
    expect(html).toContain('在这台电脑上运行的开源模型')
    expect(html).toContain('任何兼容 OpenAI API 的服务器')
  })

  it('names the one provider that isn’t a brand in Chinese, and leaves the brands as they are', () => {
    expect(html).not.toContain('Custom endpoint')
    expect(html).toContain('自定义端点')
    for (const brand of ['Anthropic', 'OpenAI', 'Google Gemini', 'OpenRouter', 'Ollama', 'LM Studio']) expect(html).toContain(brand)
  })
})
