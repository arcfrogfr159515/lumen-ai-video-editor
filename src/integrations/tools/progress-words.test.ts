import { beforeEach, describe, expect, it, vi } from 'vitest'

// A window in Chinese.
vi.stubGlobal('localStorage', { getItem: (key: string) => (key === 'lumen.language' ? 'zh-CN' : null), setItem: () => {}, removeItem: () => {} })
vi.mock('sonner', () => ({ toast: Object.assign(() => {}, { error: () => {}, success: () => {}, loading: () => 1, dismiss: () => {} }) }))
// Pictures need a real canvas and a real decoder; what a tool says while it works doesn't.
vi.mock('@/engine/stills', () => ({ timelineStills: async () => [], mediaStills: async () => [], contactSheet: () => ({ width: 1248, height: 180 }), canvasBase64: () => 'SlBFRw==' }))
vi.mock('@/project/auto-director', async (original) => ({
  ...(await original<typeof import('@/project/auto-director')>()),
  // Watching the cameras' pictures, as far as saying how far it has got.
  angleMotion: async (_project: unknown, _seq: unknown, onProgress?: (done: number) => void) => {
    onProgress?.(0.4)
    return []
  },
}))

const { language } = await import('@/lib/i18n')
const { addAsset, freshProject, run } = await import('@/editor/test-helpers')
const { runAgentTool } = await import('../agent-tools')
const { onToolProgress } = await import('./events')
const { frameProgress } = await import('./kit')
const { watchWebVideo } = await import('./web')

/** What running tools say of how they are getting on: shown under their step in the chat, and never sent to the model. */
const said: string[] = []
onToolProgress((_tool, message) => void said.push(message))

beforeEach(() => {
  said.length = 0
  freshProject('旅行短片')
})

describe('what a running tool says of how it is getting on, in a window in Chinese', () => {
  it('says it is opening and looking through a linked video in Chinese', async () => {
    expect(language).toBe('zh-CN')
    const lines: string[] = []
    // The main process fetches the video; here it is a stand-in, and the file it hands over can't be read.
    const watch = async () => ({ url: 'https://example.com/clip.mp4', site: 'example.com', chapters: [], watchedWith: 'the video file itself', notes: [], file: { id: 'file-1', url: 'lumen-media://file/nowhere.mp4', mime: 'video/mp4', size: 10 } })
    const quiet = [vi.spyOn(console, 'error').mockImplementation(() => {}), vi.spyOn(console, 'warn').mockImplementation(() => {})]
    await watchWebVideo({ url: 'https://example.com/clip.mp4' }, { progress: (line) => void lines.push(line) }, watch as never)
    quiet.forEach((spy) => spy.mockRestore())
    // Written in the tool as English, beside what it tells the model: “Opening the video…”, “Looking through the video…”.
    expect(lines).toEqual(['正在打开视频…', '正在查看视频内容…'])
  })

  it('says it is watching the cameras in Chinese', async () => {
    addAsset('cam_a', 20)
    addAsset('cam_b', 20)
    run('multicam.create', { angles: [{ assetId: 'cam_a', offset: 0 }, { assetId: 'cam_b', offset: 0 }], audio: 0, place: true, start: 0 })
    await runAgentTool('auto_direct_multicam', { dry_run: true, watch_picture: true })
    expect(said).toEqual(['正在查看各机位的画面…', '正在查看各机位的画面… 40%'])
  })

  it('counts frames in Chinese, as the same work does when the user starts it', () => {
    // An export and a cut-out an agent runs said “40% — frame 12 of 30”; the user's own cut-out said it in Chinese.
    expect(frameProgress(12, 30)).toBe('40%——第 12 帧，共 30 帧')
  })
})
