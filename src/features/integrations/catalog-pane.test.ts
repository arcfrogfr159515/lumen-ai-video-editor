import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { MCP_CATALOG } from '@shared/integrations'

// A window in Chinese, with no desktop app behind it.
vi.stubGlobal('localStorage', { getItem: (key: string) => (key === 'lumen.language' ? 'zh-CN' : null), setItem: () => {}, removeItem: () => {} })
vi.stubGlobal('requestAnimationFrame', () => 0)
vi.stubGlobal('cancelAnimationFrame', () => {})
vi.mock('sonner', () => ({ toast: Object.assign(() => {}, { error: () => {}, success: () => {}, loading: () => 1, dismiss: () => {} }) }))

const { language } = await import('@/lib/i18n')
const { CatalogPane } = await import('./IntegrationsHub')

const text = (html: string) => html.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#x27;/g, "'")

describe('a server of the MCP catalogue, before it is connected, in a window in Chinese', () => {
  it('says what it is, what it needs and how to reach it in Chinese', () => {
    expect(language).toBe('zh-CN')
    for (const entry of MCP_CATALOG) {
      const html = text(renderToString(createElement(CatalogPane, { entry, onAdded: () => {} })))
      // The catalogue is shared with the main process and written in English: its sentences were shown as they are.
      for (const sentence of [entry.tagline, entry.requirement, entry.urlHint, entry.keyHint]) if (sentence) expect(html, `${entry.id}: ${sentence.slice(0, 40)}`).not.toContain(sentence)
      // Its name is a brand's, and stays.
      expect(html).toContain(entry.name)
    }
    const fal = text(renderToString(createElement(CatalogPane, { entry: MCP_CATALOG.find((e) => e.id === 'fal')!, onAdded: () => {} })))
    expect(fal).toContain('一个 fal API 密钥')
    expect(fal).toContain('快速的生成式媒体')
  })
})
