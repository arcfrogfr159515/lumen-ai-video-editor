import { beforeEach, describe, expect, it } from 'vitest'
import { createEmptyProject } from './new-project'
import { audioRole, placeAsset } from './placement'
import { getProject, useEditor } from './store'
import type { Asset } from './types'

function audio(name: string): Asset {
  return { id: name, name, kind: 'audio', duration: 30, hasAudio: true, source: { type: 'file', url: `lumen-media://file/${name}.wav`, mime: 'audio/wav', fileName: `${name}.wav`, size: 1 }, addedAt: 0 }
}
const trackOf = (clipId: string | null) => getProject().tracks.find((t) => t.id === getProject().clips[clipId!]?.trackId)?.name

// Files as they are named: words joined by underscores, numbered, or run together with capitals.
const NAMED: Record<string, string[]> = {
  music: ['background_music', 'epic_cinematic_score_120bpm', 'bgm01', 'song1', 'EpicMusic', 'Soundtrack_v3'],
  voice: ['VO_take3', 'voiceover_final_v2', 'narration2', 'Interview_John_2024', 'recording_2024_05_01', 'PodcastEpisode12'],
  sfx: ['whoosh_01', 'door_impact_3', 'UIClick', 'riser2'],
}
const NOTHING = ['musical', 'popcorn', 'clip_0042', 'IMG_2041', 'ZOOM0012', 'hits']

beforeEach(() => {
  const p = createEmptyProject('Names')
  for (const name of [...Object.values(NAMED).flat(), ...NOTHING, 'intro-music-final', 'Whoosh 03', 'narration take 2']) p.assets[name] = audio(name)
  useEditor.getState().loadProject(p)
})

describe('what kind of sound a file is, by the words of its name', () => {
  it('is read where the words are joined by underscores, numbered, or run together', () => {
    // A word was looked for between two "word boundaries" — and an underscore and a digit are word characters:
    // "background_music" and "whoosh_01" had no word in them, and went to the first audio track, the one for speech.
    const a = getProject().assets
    for (const [role, names] of Object.entries(NAMED)) for (const name of names) expect(audioRole(a[name]), name).toBe(role)
  })

  it('is not read from a longer word that only holds one', () => {
    const a = getProject().assets
    for (const name of NOTHING) expect(audioRole(a[name]), name).toBeNull()
  })

  it('is read as before where the words are apart', () => {
    const a = getProject().assets
    expect(audioRole(a['intro-music-final'])).toBe('music')
    expect(audioRole(a['Whoosh 03'])).toBe('sfx')
    expect(audioRole(a['narration take 2'])).toBe('voice')
  })

  it('puts the file on the track made for it', () => {
    expect(trackOf(placeAsset('background_music', 0))).toBe('Music')
    expect(trackOf(placeAsset('VO_take3', 0))).toBe('Voice')
    expect(trackOf(placeAsset('whoosh_01', 30))).toBe('Sound effects')
  })
})
