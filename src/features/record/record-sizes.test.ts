import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

// A window in Chinese.
vi.stubGlobal('localStorage', { getItem: (key: string) => (key === 'lumen.language' ? 'zh-CN' : null), setItem: () => {}, removeItem: () => {} })
vi.stubGlobal('requestAnimationFrame', () => 0)
vi.stubGlobal('cancelAnimationFrame', () => {})
vi.mock('sonner', () => ({ toast: Object.assign(() => {}, { error: () => {}, success: () => {}, loading: () => 1, dismiss: () => {} }) }))
// Drawn without a browser, a dialog and a list of choices draw nothing until they are opened. Here everything that
// opens is drawn where it stands, open: the dialog's contents, and every choice of every list in it.
vi.mock('radix-ui', async () => {
  const { createElement: h } = await import('react')
  const Part = ({ children }: { children?: React.ReactNode }) => h('div', null, children)
  const parts = new Proxy({}, { get: (_, name) => (name === 'then' ? undefined : Part) })
  return { Dialog: parts, ContextMenu: parts, DropdownMenu: parts, Popover: parts, Select: parts, Slider: parts, Switch: parts, Tooltip: parts }
})

const { language } = await import('@/lib/i18n')
const { RecordDialog } = await import('./RecordDialog')

const text = (html: string) => html.replace(/<[^>]*>/g, '\n').replace(/&amp;/g, '&')

describe('the sizes a recording can be made at, in a window in Chinese', () => {
  it('names the source’s own size in Chinese', () => {
    expect(language).toBe('zh-CN')
    const shown = text(renderToString(createElement(RecordDialog)))
    // The list of sizes is shared with the main process and written in English: the first read “Native · 1920×1080”.
    expect(shown).not.toMatch(/Native/)
    expect(shown).toContain('原始 · 1920×1080')
    // The others are names that are the same in any language.
    expect(shown).toContain('4K · 3840×2160')
    expect(shown).toContain('720p · 1280×720')
  })
})
