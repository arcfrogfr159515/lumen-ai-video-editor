import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

// A window in Chinese.
vi.stubGlobal('localStorage', { getItem: (key: string) => (key === 'lumen.language' ? 'zh-CN' : null), setItem: () => {}, removeItem: () => {} })

const { language } = await import('@/lib/i18n')
const { CopyButton, Markdown } = await import('./Markdown')

/** What a button says it does: to whoever hovers over it, and to a screen reader. */
const said = (html: string) => [...html.matchAll(/<button[^>]*>/g)].map((b) => ({ title: /\btitle="([^"]*)"/.exec(b[0])?.[1], label: /\baria-label="([^"]*)"/.exec(b[0])?.[1] }))

describe('the button that copies a block of code in a reply, in a window in Chinese', () => {
  it('says what it does in Chinese', () => {
    expect(language).toBe('zh-CN')
    const html = renderToString(createElement(Markdown, { text: '这样写：\n\n```js\nconst frames = 30\n```\n' }))
    expect(html).toContain('const frames = 30')
    // The button of a block of code is the one that is given no words of its own: it said “Copy”, as the code writes it.
    expect(said(html)).toEqual([{ title: '复制', label: '复制' }])
  })

  it('still says what it is told to say', () => {
    expect(said(renderToString(createElement(CopyButton, { text: 'x', label: '复制回复' })))).toEqual([{ title: '复制回复', label: '复制回复' }])
  })
})
