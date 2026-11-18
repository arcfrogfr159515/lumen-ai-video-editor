import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Asset } from './types'

// The window speaks Chinese here: its tracks are 人声, 音乐 and 音效, and the files a user brings in are named in Chinese.
vi.stubGlobal('localStorage', { getItem: (key: string) => (key === 'lumen.language' ? 'zh-CN' : null), setItem: () => {}, removeItem: () => {} })

const { createEmptyProject } = await import('./new-project')
const { audioRole, placeAsset } = await import('./placement')
const { getProject, useEditor } = await import('./store')

function audio(name: string, extra: Partial<Asset> = {}): Asset {
  return { id: name, name, kind: 'audio', duration: 30, hasAudio: true, source: { type: 'file', url: `lumen-media://file/${name}.wav`, mime: 'audio/wav', fileName: `${name}.wav`, size: 1 }, addedAt: 0, ...extra }
}
const trackOf = (clipId: string | null) => getProject().tracks.find((t) => t.id === getProject().clips[clipId!]?.trackId)?.name

const NAMED = {
  music: ['背景音乐', '片头配乐-终版', '主题歌曲', '钢琴伴奏'],
  voice: ['旁白', '男声配音 02', '采访录音', '解说词朗读', '人声干声'],
  sfx: ['开门音效', '转场效果音'],
}

beforeEach(() => {
  const p = createEmptyProject('影片')
  for (const name of [...NAMED.music, ...NAMED.voice, ...NAMED.sfx, '素材-0042', 'intro-music-final', 'Whoosh 03', 'narration take 2']) p.assets[name] = audio(name)
  useEditor.getState().loadProject(p)
})

describe('what kind of sound a file is, by its name', () => {
  it('is read from a Chinese name as it is from an English one', () => {
    // Only English words were looked for: 背景音乐 was no kind of sound at all, and went to the first audio track
    // there is — the one for speech.
    const a = getProject().assets
    for (const name of NAMED.music) expect(audioRole(a[name]), name).toBe('music')
    for (const name of NAMED.voice) expect(audioRole(a[name]), name).toBe('voice')
    for (const name of NAMED.sfx) expect(audioRole(a[name]), name).toBe('sfx')
    expect(audioRole(a['素材-0042'])).toBeNull()
  })

  it('is read from an English name as before', () => {
    const a = getProject().assets
    expect(audioRole(a['intro-music-final'])).toBe('music')
    expect(audioRole(a['Whoosh 03'])).toBe('sfx')
    expect(audioRole(a['narration take 2'])).toBe('voice')
  })

  it('puts the file on the track made for it', () => {
    expect(trackOf(placeAsset('背景音乐', 0))).toBe('音乐')
    expect(trackOf(placeAsset('旁白', 0))).toBe('人声')
    expect(trackOf(placeAsset('开门音效', 30))).toBe('音效')
  })
})
