import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { LinkRow, linkFileName } from './parts'

const provenance = { integration: 'mcp', tool: 'generate' }
const row = (url: string) => renderToString(createElement(LinkRow, { link: { url }, provenance }))

describe('a link a tool gave back', () => {
  it('is drawn with the file’s name', () => {
    expect(row('https://cdn.example.com/out/My%20Clip.mp4')).toContain('My Clip.mp4')
    expect(linkFileName('https://cdn.example.com/out/My%20Clip.mp4')).toBe('My Clip.mp4')
    expect(linkFileName('https://cdn.example.com/')).toBe('cdn.example.com')
  })

  it('is still drawn when its name holds a "%" that isn’t an escape', () => {
    // Read as an escape it threw while the row was being drawn, and the whole dialog went with it.
    expect(row('https://cdn.example.com/out/100%_final.png')).toContain('100%_final.png')
    expect(linkFileName('https://cdn.example.com/out/100%_final.png')).toBe('100%_final.png')
  })

  it('is still drawn when what the tool called a link isn’t an address', () => {
    // A resource "uri" is whatever the server wrote: a bare name, a path.
    expect(row('render-0042.png')).toContain('render-0042.png')
    expect(linkFileName('render-0042.png')).toBe('render-0042.png')
    expect(linkFileName('')).toBe('')
  })
})
