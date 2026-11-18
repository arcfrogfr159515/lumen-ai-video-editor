import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Asset, Clip, Project } from './types'

// Speech activity per asset, standing in for decoding and measuring real audio.
const activity = new Map<string, [number, number][]>()
vi.mock('@/engine/audio-engine', () => ({
  isAudible: (project: Project, clip: Clip) => (clip.kind === 'audio' || clip.kind === 'video') && Boolean(clip.assetId) && !project.tracks.find((t) => t.id === clip.trackId)?.muted,
  loadAudio: async (asset: Asset) => ({ assetId: asset.id }),
  activeRegions: (buffer: { assetId: string }) => activity.get(buffer.assetId) ?? [],
  isLongAudio: () => false,
  activeRegionsStreamed: async (asset: Asset) => activity.get(asset.id) ?? [],
}))

const { ROLE_TRACK } = await import('./track-roles')
const { bedClips, musicClips, voiceClips } = await import('./smart')
const { getProject } = await import('./store')
const { addAsset, freshProject, run } = await import('./test-helpers')

beforeEach(() => {
  activity.clear()
  freshProject('Tracks')
})

describe('a track named the way an editor numbers tracks', () => {
  it('is for speech when it is called VO, however it is numbered', () => {
    // "VO" was looked for between two word boundaries, and a digit and an underscore are word characters: VO1 and
    // VO_2 were no speech tracks.
    for (const name of ['VO', 'VO 1', 'VO1', 'VO2', 'VO_2', 'vo-main', 'Voice 2', 'Narration', '人声']) expect(ROLE_TRACK.voice.test(name), name).toBe(true)
    for (const name of ['Video 2', 'Pivot', 'Vocals', 'Avocado', 'Music', 'Sound effects']) expect(ROLE_TRACK.voice.test(name), name).toBe(false)
  })

  it('is for music when it is called a bed, however it is numbered', () => {
    for (const name of ['Music bed', 'Bed', 'Bed 1', 'bed1', 'BED_A', 'Music 2', 'Score', '音乐']) expect(ROLE_TRACK.music.test(name), name).toBe(true)
    for (const name of ['Embedded', 'Bedroom tone', 'Voice', 'VO1']) expect(ROLE_TRACK.music.test(name), name).toBe(false)
  })

  it('is what its name says: a voiceover on VO1 is speech, not a bed of music to leave whole', () => {
    const voiceTrack = getProject().tracks.find((t) => t.name === 'Voice')!.id
    run('track.update', { id: voiceTrack, patch: { name: 'VO1' } })
    addAsset('take', 30, 'audio')
    activity.set('take', [[0, 2], [3.5, 30]])
    const clip = run('clip.add', { trackId: voiceTrack, kind: 'audio', assetId: 'take', start: 0, duration: 900 }) as string
    const p = getProject()
    expect(voiceClips(p).map((c) => c.id)).toEqual([clip])
    expect(bedClips(p)).toEqual([])
    expect(musicClips(p)).toEqual([])
  })
})
