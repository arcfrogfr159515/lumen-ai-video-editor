import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Asset, Project } from '@/editor/types'

vi.mock('@/engine/stills', () => ({
  timelineStills: async (_p: Project, frames: number[], width: number) => frames.map(() => ({ width, height: Math.round((width * 9) / 16) })),
  mediaStills: async (_a: Asset, times: number[], width: number) => times.map(() => ({ width, height: Math.round((width * 9) / 16) })),
  contactSheet: (cells: unknown[]) => ({ width: 1248, height: 180 * Math.ceil(cells.length / 3) }),
}))

const SRT = '1\n00:00:01,000 --> 00:00:02,000\nHello\n\n2\n00:00:03,000 --> 00:00:04,500\nWorld\n'
/** The disk, as the main process sees it: asking about a file is also what lets the page read it. */
const disk = vi.hoisted(() => ({
  files: new Map<string, { text: string; size?: number; name?: string }>(),
  asked: [] as string[],
  read: [] as string[],
}))

vi.mock('@/lib/platform', () => ({
  platform: { isMac: false },
  desktop: {
    files: {
      urlForPath: async (path: string) => {
        disk.asked.push(path)
        const file = disk.files.get(path)
        if (!file) return null
        return { path, url: `lumen-media://file/${encodeURIComponent(path)}`, name: file.name ?? path.split(/[\\/]/).pop()!, size: file.size ?? file.text.length, mime: 'text/plain', mtime: 0 }
      },
    },
  },
}))

vi.stubGlobal('fetch', async (url: string) => {
  const path = decodeURIComponent(String(url).replace('lumen-media://file/', ''))
  disk.read.push(path)
  return new Response(disk.files.get(path)!.text)
})

const { runAgentTool } = await import('../agent-tools')
const { useEditor, getProject } = await import('@/editor/store')
const { createEmptyProject } = await import('@/editor/new-project')

async function importFrom(path: string) {
  const res = await runAgentTool('import_subtitles', { path })
  const text = res.content.find((c) => c.type === 'text')
  return res.isError ? { error: text && 'text' in text ? text.text : '' } : (res.structuredContent as Record<string, unknown>)
}
const captions = () => Object.values(getProject().clips).filter((c) => c.kind === 'text').length

beforeEach(() => {
  useEditor.getState().loadProject(createEmptyProject('Film'))
  disk.files.clear()
  disk.asked.length = 0
  disk.read.length = 0
})

describe('import_subtitles, given a path', () => {
  it('reads .srt and .vtt files', async () => {
    disk.files.set('C:\\Film\\talk.srt', { text: SRT })
    disk.files.set('/home/me/Talk.VTT', { text: `WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello\n` })
    expect(await importFrom('C:\\Film\\talk.srt')).toMatchObject({ captions_added: 2, cues_in_file: 2 })
    expect(await importFrom('/home/me/Talk.VTT')).toMatchObject({ captions_added: 1 })
    expect(disk.read).toEqual(['C:\\Film\\talk.srt', '/home/me/Talk.VTT'])
  })

  it('doesn’t so much as ask about a file that isn’t one', async () => {
    const others = [
      'C:\\Users\\me\\.ssh\\id_rsa',
      'C:\\Users\\me\\AppData\\Roaming\\Lumen\\secrets.json',
      '/etc/passwd',
      'C:\\Film\\talk.srt.txt',
      'C:\\Film\\talk.srt\\..\\..\\keys.json',
      'C:\\Film\\talk.srt ',
      'C:\\Film\\srt',
      'C:\\Film\\notes.SRT.bak',
    ]
    for (const path of others) {
      // It is there, and it even holds subtitles: what it is called is what decides.
      disk.files.set(path, { text: SRT })
      expect(await importFrom(path), path).toEqual({ error: expect.stringMatching(/Only \.srt and \.vtt files are read from a path/) })
    }
    expect(disk.asked).toEqual([])
    expect(disk.read).toEqual([])
    expect(captions()).toBe(0)
  })

  it('doesn’t read what turns out to be another file, or one far too large to be subtitles', async () => {
    // The path ends as a subtitle file's does; what it resolves to doesn't.
    disk.files.set('C:\\Film\\link.srt', { text: SRT, name: 'keys.json' })
    disk.files.set('C:\\Film\\huge.srt', { text: SRT, size: 3 * 1024 * 1024 * 1024 })
    expect(await importFrom('C:\\Film\\link.srt')).toEqual({ error: expect.stringMatching(/Only \.srt and \.vtt/) })
    expect(await importFrom('C:\\Film\\huge.srt')).toEqual({ error: expect.stringMatching(/huge\.srt is 3072 MB — too large to be subtitles/) })
    expect(disk.read).toEqual([])
    expect(captions()).toBe(0)
  })

  it('says so when the file isn’t there', async () => {
    expect(await importFrom('C:\\Film\\gone.srt')).toEqual({ error: expect.stringMatching(/Can’t read C:\\Film\\gone\.srt/) })
  })
})
