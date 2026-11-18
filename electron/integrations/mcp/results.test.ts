import { describe, expect, it, vi } from 'vitest'

// Nothing is saved or fetched here: these results are text, and the links in it.
vi.mock('electron', () => ({ app: { getPath: (name: string) => `nowhere/${name}` }, net: {}, nativeImage: {}, session: {}, shell: {} }))

const { convertResult } = await import('./results')

const provenance = { integration: 'studio', tool: 'generate_video', prompt: 'a lighthouse at dusk' }
/** The media a tool's answer links to, when the answer is these words. */
const linksIn = (...said: string[]) => convertResult({ content: said.map((text) => ({ type: 'text', text })) }, provenance).links.map((l) => l.url)

describe('what a tool’s answer links to', () => {
  it('is found when the link ends a sentence', () => {
    // A link was taken only when a space, a quote, a bracket or a comma came after it. Tools answer in sentences —
    // "Your video is ready: https://…/clip.mp4." — and with the full stop after it, the link wasn't one: the answer
    // had nothing to bring in.
    expect(linksIn('Your video is ready: https://cdn.example.com/out/clip.mp4.')).toEqual(['https://cdn.example.com/out/clip.mp4'])
    expect(linksIn('Done! https://cdn.example.com/a.png; then https://cdn.example.com/b.webm!')).toEqual(['https://cdn.example.com/a.png', 'https://cdn.example.com/b.webm'])
    expect(linksIn('Is this it: https://cdn.example.com/take.mp3?')).toEqual(['https://cdn.example.com/take.mp3'])
    // What ends the sentence isn't part of what the link asks for.
    expect(linksIn('It is at https://cdn.example.com/c.mov?sig=abc123&exp=99.')).toEqual(['https://cdn.example.com/c.mov?sig=abc123&exp=99'])
  })

  it('is found as before in a list, in brackets, in quotes, and in what a tool writes as JSON', () => {
    expect(linksIn('Two: https://x.example/a.png, https://x.example/b.jpg')).toEqual(['https://x.example/a.png', 'https://x.example/b.jpg'])
    expect(linksIn('See (https://x.example/d.jpg) or "https://x.example/e.gif" — https://x.example/f.wav?a=1,2&b=3 too')).toEqual(['https://x.example/d.jpg', 'https://x.example/e.gif', 'https://x.example/f.wav?a=1,2&b=3'])
    expect(linksIn('{"status":"done","output":{"video_url":"https://x.example/render/123"}}')).toEqual(['https://x.example/render/123'])
  })

  it('isn’t found where there is no media', () => {
    expect(linksIn('Read https://x.example/guide.html. Or get https://x.example/film.mp4.torrent.')).toEqual([])
    expect(linksIn('No links here.')).toEqual([])
  })
})
