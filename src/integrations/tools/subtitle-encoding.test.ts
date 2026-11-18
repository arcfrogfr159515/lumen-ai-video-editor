import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Asset, Project } from '@/editor/types'

vi.mock('@/engine/stills', () => ({
  timelineStills: async (_p: Project, frames: number[], width: number) => frames.map(() => ({ width, height: Math.round((width * 9) / 16) })),
  mediaStills: async (_a: Asset, times: number[], width: number) => times.map(() => ({ width, height: Math.round((width * 9) / 16) })),
  contactSheet: (cells: unknown[]) => ({ width: 1248, height: 180 * Math.ceil(cells.length / 3) }),
}))

const said = vi.hoisted(() => ({ success: [] as string[], error: [] as string[] }))
vi.mock('sonner', () => ({
  toast: Object.assign(() => {}, {
    success: (text: string) => void said.success.push(text),
    error: (text: string, more?: { description?: string }) => void said.error.push(`${text}: ${more?.description}`),
  }),
}))

/** The disk: a file is the bytes it was saved as. */
const disk = vi.hoisted(() => ({ files: new Map<string, Uint8Array>() }))
vi.mock('@/lib/platform', () => ({
  platform: { isMac: false },
  desktop: {
    files: {
      urlForPath: async (path: string) => {
        const bytes = disk.files.get(path)
        return bytes ? { path, url: `lumen-media://file/${encodeURIComponent(path)}`, name: path.split(/[\\/]/).pop()!, size: bytes.byteLength, mime: 'text/plain', mtime: 0 } : null
      },
    },
  },
}))
vi.stubGlobal('fetch', async (url: string) => new Response(disk.files.get(decodeURIComponent(String(url).replace('lumen-media://file/', '')))! as BodyInit))

const { runAgentTool } = await import('../agent-tools')
const { useEditor, getProject } = await import('@/editor/store')
const { createEmptyProject } = await import('@/editor/new-project')
const { loadSubtitleFile } = await import('@/project/subtitle-files')

const SRT = '1\r\n00:00:01,000 --> 00:00:02,000\r\n中文字幕\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,500\r\nÀ bientôt\r\n'
const WORDS = ['中文字幕', 'À bientôt']
/** The same subtitles as each way of saving them writes the file. */
const SAVED: Record<string, Uint8Array> = {
  'UTF-8': Buffer.from(SRT, 'utf8'),
  'UTF-8 with a byte order mark': Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(SRT, 'utf8')]),
  // What Notepad saves as “Unicode” / “UTF-16 LE”, and what several subtitle editors write.
  'UTF-16, low byte first': Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(SRT, 'utf16le')]),
  'UTF-16, high byte first': Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(SRT, 'utf16le').swap16()]),
}

const captions = () =>
  Object.values(getProject().clips)
    .filter((c) => c.kind === 'text')
    .sort((a, b) => a.start - b.start)
    .map((c) => c.text?.content)

beforeEach(() => {
  useEditor.getState().loadProject(createEmptyProject('Film'))
  disk.files.clear()
  said.success.length = 0
  said.error.length = 0
})

describe('a subtitle file, however it was saved', () => {
  for (const [saved, bytes] of Object.entries(SAVED)) {
    it(`is read when it is dropped in — ${saved}`, async () => {
      // A file in UTF-16 opens with a mark that says so. It was read as UTF-8 all the same: nothing in it looked
      // like subtitles any more, and it was refused with "No subtitles found — is it an .srt or .vtt file?".
      const res = await loadSubtitleFile(new File([bytes as BlobPart], 'talk.srt'))
      expect(said.error).toEqual([])
      expect(res).toMatchObject({ added: 2, cues: 2 })
      expect(captions()).toEqual(WORDS)
    })

    it(`is read when the Copilot is given its path — ${saved}`, async () => {
      disk.files.set('C:\\Film\\talk.srt', bytes)
      const res = await runAgentTool('import_subtitles', { path: 'C:\\Film\\talk.srt' })
      expect(res.isError, JSON.stringify(res.content)).toBeFalsy()
      expect(res.structuredContent).toMatchObject({ captions_added: 2, cues_in_file: 2 })
      expect(captions()).toEqual(WORDS)
    })
  }
})
