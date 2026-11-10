/**
 * Guides inside clips: where speech pauses and where one shot gives way to the
 * next. The timeline draws them and edits snap to them, so a cut lands in the
 * silence between two sentences, or on the frame a shot changes, without
 * zooming in to find it.
 */
import { PEAKS_PER_SECOND } from './defaults'
import { consumed, localForSource } from './timing'
import type { Asset, Clip, Frame, Project, SpeechSegment } from './types'

/** speech: talking starts here · pause: talking stops here · cut: a new shot starts here. */
export type GuideKind = 'speech' | 'pause' | 'cut'

export interface Guide {
  frame: Frame
  kind: GuideKind
  clipId: string
}

/** The shortest silence worth a guide, in seconds. */
export const MIN_PAUSE = 0.3

// ─── Pauses ──────────────────────────────────────────────────────────────

/** The silences between phrases of a transcript: [start, end] in source seconds. */
export function transcriptPauses(script: readonly SpeechSegment[], minGap = MIN_PAUSE): [number, number][] {
  const lines = [...script].filter((s) => s.end > s.start).sort((a, b) => a.start - b.start)
  const out: [number, number][] = []
  let end = -Infinity
  for (const line of lines) {
    if (end > -Infinity && line.start - end >= minGap) out.push([end, line.start])
    end = Math.max(end, line.end)
  }
  return out
}

/**
 * The silences in a waveform: stretches of at least `minGap` seconds that stay
 * under a level set by the sound itself (a tenth of its loud parts), so a
 * quiet recording and a hot one are read alike. Silence at the very start or
 * end of the file isn't a pause between two things.
 */
export function waveformPauses(peaks: ArrayLike<number>, minGap = MIN_PAUSE, perSecond = PEAKS_PER_SECOND): [number, number][] {
  const n = peaks.length
  if (n < perSecond) return []
  const sorted = Array.from(peaks).sort((a, b) => a - b)
  const loud = sorted[Math.floor(n * 0.95)]
  if (!(loud > 0)) return []
  const floor = Math.max(0.012, loud * 0.1)
  const out: [number, number][] = []
  let run = -1
  for (let i = 0; i <= n; i++) {
    const quiet = i < n && peaks[i] < floor
    if (quiet && run < 0) run = i
    else if (!quiet && run >= 0) {
      if (run > 0 && i < n && (i - run) / perSecond >= minGap) out.push([run / perSecond, i / perSecond])
      run = -1
    }
  }
  return out
}

const pauseCache = new WeakMap<Asset, [number, number][]>()

/** Where an asset's sound pauses (source seconds): from its transcript when it has one, else from its waveform. */
export function assetPauses(asset: Asset): [number, number][] {
  const hit = pauseCache.get(asset)
  if (hit) return hit
  const pauses = asset.transcript?.length ? transcriptPauses(asset.transcript) : asset.peaks?.length ? waveformPauses(asset.peaks) : []
  pauseCache.set(asset, pauses)
  return pauses
}

const VOICE_TRACK = /voice|vo\b|dialog|narrat|interview|speech/i

/**
 * Whether a clip's sound is worth reading for pauses: something transcribed, or
 * sound on the main track or a track named for voices. Music has silences too,
 * but nobody cuts to them.
 */
export function carriesSpeech(project: Pick<Project, 'assets' | 'tracks'>, clip: Clip): boolean {
  if ((clip.kind !== 'video' && clip.kind !== 'audio') || clip.freeze || clip.sequenceId || !clip.assetId) return false
  if (clip.kind === 'video' && clip.audio.detached) return false
  const asset = project.assets[clip.assetId]
  if (!asset || asset.hasAudio === false) return false
  if (asset.transcript?.length) return true
  const track = project.tracks.find((t) => t.id === clip.trackId)
  return Boolean(track && (track.role === 'main' || VOICE_TRACK.test(track.name)))
}

// ─── Shot cuts ───────────────────────────────────────────────────────────

/**
 * The shot cuts known for an asset after analysing [from, to] of it: what was
 * found there replaces what was known there, the rest is kept.
 */
export function mergeSceneCuts(known: readonly number[] | undefined, found: readonly number[], from: number, to: number): number[] {
  const kept = (known ?? []).filter((t) => t < from - 1e-3 || t > to + 1e-3)
  const all = [...kept, ...found].map((t) => Math.round(t * 1000) / 1000).sort((a, b) => a - b)
  return all.filter((t, i) => i === 0 || t - all[i - 1] > 1e-3)
}

// ─── On the timeline ─────────────────────────────────────────────────────

export interface GuideOptions {
  pauses?: boolean
  cuts?: boolean
}

/** A clip's guides, as frames from its start — following its trims, speed, ramps and reverse. */
export function clipGuides(project: Pick<Project, 'assets' | 'tracks' | 'settings'>, clip: Clip, opts: GuideOptions = { pauses: true, cuts: true }): { local: Frame; kind: GuideKind }[] {
  const asset = clip.assetId ? project.assets[clip.assetId] : undefined
  if (!asset || clip.freeze || clip.sequenceId) return []
  const fps = project.settings.fps
  const from = clip.inPoint / fps
  const to = (clip.inPoint + consumed(clip)) / fps
  const out: { local: Frame; kind: GuideKind }[] = []
  const place = (sec: number, kind: GuideKind) => {
    if (sec <= from || sec >= to) return
    const local = localForSource(clip, sec * fps)
    if (local === null) return
    const f = Math.round(local)
    if (f > 0 && f < clip.duration) out.push({ local: f, kind })
  }
  if (opts.pauses !== false && carriesSpeech(project, clip)) {
    for (const [a, b] of assetPauses(asset)) {
      // Played backwards, talking stops where it started.
      place(a, clip.reverse ? 'speech' : 'pause')
      place(b, clip.reverse ? 'pause' : 'speech')
    }
  }
  if (opts.cuts !== false && clip.kind === 'video') for (const t of asset.sceneCuts ?? []) place(t, 'cut')
  // Two guides on one frame: the shot cut is the one that matters.
  const byFrame = new Map<Frame, GuideKind>()
  for (const g of out) if (!byFrame.has(g.local) || g.kind === 'cut') byFrame.set(g.local, g.kind)
  return [...byFrame].sort((x, y) => x[0] - y[0]).map(([local, kind]) => ({ local, kind }))
}

const cache = new WeakMap<Record<string, Clip>, { assets: unknown; tracks: unknown; key: string; guides: Guide[] }>()

/** Every guide on the timeline, in order (on unlocked tracks). */
export function timelineGuides(project: Pick<Project, 'clips' | 'assets' | 'tracks' | 'settings'>, opts: GuideOptions = { pauses: true, cuts: true }): Guide[] {
  const key = `${opts.pauses !== false}|${opts.cuts !== false}`
  const hit = cache.get(project.clips)
  if (hit && hit.assets === project.assets && hit.tracks === project.tracks && hit.key === key) return hit.guides
  const locked = new Set(project.tracks.filter((t) => t.locked).map((t) => t.id))
  const guides: Guide[] = []
  for (const clip of Object.values(project.clips)) {
    if (locked.has(clip.trackId)) continue
    for (const g of clipGuides(project, clip, opts)) guides.push({ frame: clip.start + g.local, kind: g.kind, clipId: clip.id })
  }
  guides.sort((a, b) => a.frame - b.frame)
  cache.set(project.clips, { assets: project.assets, tracks: project.tracks, key, guides })
  return guides
}

/** The guide nearest a frame within `within` frames, if any. */
export function nearestGuide(guides: readonly Guide[], frame: Frame, within: number): Guide | null {
  let best: Guide | null = null
  for (const g of guides) {
    const d = Math.abs(g.frame - frame)
    if (d <= within && (!best || d < Math.abs(best.frame - frame))) best = g
  }
  return best
}

