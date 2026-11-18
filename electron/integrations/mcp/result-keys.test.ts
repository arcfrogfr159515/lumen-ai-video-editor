import { describe, expect, it, vi } from 'vitest'

// Nothing is saved or fetched here: these results are what a tool writes, and the links in it.
vi.mock('electron', () => ({ app: { getPath: (name: string) => `nowhere/${name}` }, net: {}, nativeImage: {}, session: {}, shell: {} }))

const { convertResult } = await import('./results')

const provenance = { integration: 'studio', tool: 'generate_video', prompt: 'a lighthouse at dusk' }
const links = (result: Record<string, unknown>) => convertResult(result, provenance).links.map((l) => l.url)
/** The media a tool's answer links to, when the answer is this JSON written out as text. */
const linksIn = (json: unknown) => links({ content: [{ type: 'text', text: JSON.stringify(json) }] })

describe('a link under a field named for what it holds', () => {
  it('is found however the service writes its field names', () => {
    // An address with no file name in it is taken for media by the field it is under. Only fields written with
    // underscores were known — video_url — and a service that writes videoUrl answered with nothing to bring in.
    expect(linksIn({ status: 'done', output: { videoUrl: 'https://x.example/render/123' } })).toEqual(['https://x.example/render/123'])
    expect(linksIn({ imageURL: 'https://x.example/img/9f2c' })).toEqual(['https://x.example/img/9f2c'])
    expect(linksIn({ downloadUrl: 'https://x.example/files/41d0/content' })).toEqual(['https://x.example/files/41d0/content'])
    expect(linksIn({ outputUrls: ['https://x.example/o/1', 'https://x.example/o/2'] })).toEqual(['https://x.example/o/1', 'https://x.example/o/2'])
    expect(linksIn({ result: { audioFile: 'https://x.example/take/7' } })).toEqual(['https://x.example/take/7'])
    // The same in what a tool hands over as structured content.
    expect(links({ content: [], structuredContent: { videoUrl: 'https://x.example/render/456' } })).toEqual(['https://x.example/render/456'])
  })

  it('is found as before under fields written with underscores, or in one word', () => {
    expect(linksIn({ video_url: 'https://x.example/render/1', images: ['https://x.example/i/2'], url: 'https://x.example/3', download_urls: ['https://x.example/4'] })).toEqual([
      'https://x.example/render/1',
      'https://x.example/i/2',
      'https://x.example/3',
      'https://x.example/4',
    ])
  })

  it('isn’t found under a field that only ends in the same letters', () => {
    expect(linksIn({ curl: 'https://x.example/api', profile: 'https://x.example/me', hurl: 'https://x.example/x', resultset: 'https://x.example/y', videoUrlHash: 'https://x.example/z' })).toEqual([])
  })
})
