import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Asset, Clip, Project } from './types'

// A window in Chinese: a new project's tracks are 标题, 叠加, 主视频, 人声, 音乐, 音效.
vi.stubGlobal('localStorage', { getItem: (key: string) => (key === 'lumen.language' ? 'zh-CN' : null), setItem: () => {}, removeItem: () => {} })

// Speech activity per asset, standing in for decoding and measuring real audio.
const activity = new Map<string, [number, number][]>()
vi.mock('@/engine/audio-engine', () => ({
  isAudible: (project: Project, clip: Clip) => (clip.kind === 'audio' || clip.kind === 'video') && Boolean(clip.assetId) && !project.tracks.find((t) => t.id === clip.trackId)?.muted,
  loadAudio: async (asset: Asset) => ({ assetId: asset.id }),
  activeRegions: (buffer: { assetId: string }) => activity.get(buffer.assetId) ?? [],
  isLongAudio: () => false,
  activeRegionsStreamed: async (asset: Asset) => activity.get(asset.id) ?? [],
}))

const { language } = await import('@/lib/i18n')
const { bedClips, findPauses, musicClips, voiceClips } = await import('./smart')
const { carriesSpeech } = await import('./guides')
const { getProject } = await import('./store')
const { addAsset, freshProject, run } = await import('./test-helpers')

const track = (name: string) => getProject().tracks.find((t) => t.name === name)!.id
const put = (trackName: string, assetId: string, frames: number) => run('clip.add', { trackId: track(trackName), kind: 'audio', assetId, start: 0, duration: frames }) as string

beforeEach(() => {
  activity.clear()
  freshProject('旅行短片')
})

describe('the tracks of a project made in a Chinese window', () => {
  it('are named in Chinese', () => {
    expect(language).toBe('zh-CN')
    expect(getProject().tracks.map((t) => t.name)).toEqual(['标题', '叠加', '主视频', '人声', '音乐', '音效'])
  })

  it('are what their names say: a voiceover on 人声 is speech — to cut pauses out of, not a bed to leave whole', async () => {
    // A voiceover that hasn't been transcribed: thirty seconds, with a pause from 2 s to 3.5 s.
    addAsset('旁白', 30, 'audio')
    activity.set('旁白', [[0, 2], [3.5, 30]])
    const voice = put('人声', '旁白', 900)
    const p = getProject()
    // Told from the track's name, which was looked for in English only: on 人声 it was taken for a music bed.
    expect(voiceClips(p).map((c) => c.id)).toEqual([voice])
    expect(bedClips(p)).toEqual([])
    expect(musicClips(p)).toEqual([])
    expect(carriesSpeech(p, p.clips[voice])).toBe(true)
    expect((await findPauses(p)).map((r) => r.clip.id)).toEqual([voice])
  })

  it('are what their names say: a short sting on 音乐 is music, and long ambience on 音效 isn’t', () => {
    addAsset('片头曲', 8, 'audio')
    addAsset('环境声', 60, 'audio')
    const sting = put('音乐', '片头曲', 240)
    put('音效', '环境声', 900)
    expect(musicClips(getProject()).map((c) => c.id)).toEqual([sting])
  })
})
