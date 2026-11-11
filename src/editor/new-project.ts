import { uid } from '@/lib/id'
import { createTrack, TRACK_HEIGHTS } from './defaults'
import type { Project, ProjectSettings } from './types'
import { tt } from '@/lib/i18n'

export interface CanvasPreset {
  id: string
  label: string
  hint: string
  width: number
  height: number
}

export const CANVAS_PRESETS: CanvasPreset[] = [
  { id: 'landscape', label: tt('Landscape'), hint: tt('16:9 · YouTube, TV'), width: 1920, height: 1080 },
  { id: 'vertical', label: tt('Vertical'), hint: tt('9:16 · Reels, TikTok, Shorts'), width: 1080, height: 1920 },
  { id: 'square', label: tt('Square'), hint: tt('1:1 · Feed posts'), width: 1080, height: 1080 },
  { id: 'portrait', label: tt('Portrait'), hint: tt('4:5 · Instagram feed'), width: 1080, height: 1350 },
  { id: 'uhd', label: tt('4K UHD'), hint: '16:9 · 3840 × 2160', width: 3840, height: 2160 },
  { id: 'cinema', label: tt('Cinema'), hint: '2.39:1 · 2560 × 1072', width: 2560, height: 1072 },
]

export const FRAME_RATES = [24, 25, 30, 50, 60]

/** The standard track layout: titles and overlays over a magnetic main track, then audio. */
export function defaultTracks() {
  return [
    createTrack('video', { name: tt('Titles'), role: 'titles', height: TRACK_HEIGHTS.titles }),
    createTrack('video', { name: tt('Overlay'), height: TRACK_HEIGHTS.video }),
    createTrack('video', { name: tt('Main'), role: 'main', height: TRACK_HEIGHTS.main }),
    createTrack('audio', { name: tt('Voice'), height: TRACK_HEIGHTS.audio }),
    createTrack('audio', { name: tt('Music'), height: TRACK_HEIGHTS.audio }),
    createTrack('audio', { name: tt('Sound effects'), height: TRACK_HEIGHTS.sfx }),
  ]
}

/** A blank project with the standard track layout. */
export function createEmptyProject(name = 'Untitled', settings: Partial<ProjectSettings> = {}): Project {
  const tracks = defaultTracks()
  return {
    id: uid('proj'),
    name,
    settings: { width: 1920, height: 1080, fps: 30, background: '#000000', ...settings },
    assets: {},
    tracks,
    clips: {},
    markers: [],
    createdAt: Date.now(),
  }
}
