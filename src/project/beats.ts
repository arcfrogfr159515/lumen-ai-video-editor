/**
 * Beat detection for media in the project: finds a track's tempo, beats and
 * downbeats once (kept on the media item), and lays clips out on the beat.
 */
import { clipBeats, musicClip, type TimelineBeat } from '@/editor/beat-grid'
import { clipEnd, clipsOnTrack, isMagneticTrack, overlaps, sourceFrames } from '@/editor/ops'
import { dispatch, getProject, rollbackTo, savepoint, useEditor } from '@/editor/store'
import type { Asset, Clip } from '@/editor/types'
import { loadAudio } from '@/engine/audio-engine'
import { detectBeats, type BeatGrid } from '@/engine/beats'
import { decodeAudio } from '@/engine/decode'
import { tt } from '@/lib/i18n'

const running = new Map<string, Promise<BeatGrid>>()

/** The beat grid of a media item, found the first time and kept on it. */
export function analyzeBeats(assetId: string): Promise<BeatGrid> {
  const asset = getProject().assets[assetId]
  if (!asset) return Promise.reject(new Error(tt('That media isn’t in the project.')))
  if (asset.beats) return Promise.resolve(asset.beats)
  let job = running.get(assetId)
  if (!job) {
    job = find(asset).finally(() => running.delete(assetId))
    running.set(assetId, job)
  }
  return job
}

async function find(asset: Asset): Promise<BeatGrid> {
  if (asset.kind === 'image') throw new Error(tt('“{0}” is an image — it has no sound.', asset.name))
  if (asset.source.type !== 'file' || asset.source.missing) throw new Error(tt('“{0}” is offline.', asset.name))
  // Long files stream in playback; beats only need the first quarter hour, decoded once.
  const buffer = (await loadAudio(asset)) ?? (await decodeAudio(asset.source.url))
  if (!buffer) throw new Error(tt('“{0}” has no sound Lumen can decode.', asset.name))
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c))
  const grid = await detectBeats(channels, buffer.sampleRate)
  if (getProject().assets[asset.id]) dispatch('asset.update', { id: asset.id, patch: { beats: grid } }, { history: false })
  return grid
}

/** The beats of a music clip on the timeline (detecting them first if needed). */
export async function beatsOf(clip: Clip): Promise<{ grid: BeatGrid; beats: TimelineBeat[] }> {
  if (!clip.assetId) throw new Error(tt('That clip has no media to listen to.'))
  const grid = await analyzeBeats(clip.assetId)
  return { grid, beats: clipBeats(getProject(), getProject().clips[clip.id] ?? clip) }
}

export interface MontageResult {
  music: string
  bpm: number
  placed: { clip_id: string; start_seconds: number; beats: number }[]
}

/**
 * Lays clips out one after another on the beat of a music clip: each lasts
 * `every` beats (1, 2, 4 = a bar…), starting on the first beat at or after
 * `from` (a timeline frame). Clips whose media runs out end early and the next
 * one starts on the following beat. One undo step.
 */
export async function cutToBeats(clipIds: string[], opts: { every?: number; music?: string; from?: number; downbeat?: boolean } = {}): Promise<MontageResult> {
  const project = getProject()
  const music = musicClip(project, opts.music)
  if (!music) throw new Error(tt('Add music to the timeline first — the cuts follow its beat.'))
  const { grid, beats } = await beatsOf(music)
  if (beats.length < 2) throw new Error(tt('Couldn’t find a steady beat in that music.'))
  const clips = clipIds
    .map((id) => getProject().clips[id])
    .filter((c): c is Clip => Boolean(c) && c.kind !== 'audio' && c.id !== music.id)
    .sort((a, b) => a.start - b.start)
  if (!clips.length) throw new Error(tt('Select the video or image clips to cut to the beat.'))
  const every = Math.max(1, Math.round(opts.every ?? 2))
  const from = opts.from ?? Math.min(...clips.map((c) => c.start))
  let i = beats.findIndex((b) => b.frame >= from && (!opts.downbeat || b.down))
  // (A clip runs from one beat to another: from the last beat on there is none to run to.)
  if (i < 0 || i >= beats.length - 1) throw new Error(tt('There are no beats after that point.'))
  const fps = getProject().settings.fps
  const placed: MontageResult['placed'] = []
  // All of it or none. A move that was refused (a locked track), or that landed a clip somewhere else than on its
  // beat (the place was taken), used to pass unnoticed: the clip was then cut to end where it should have ended on
  // the beat — a frame of it was left, wherever it had landed — and every clip was said to have been placed.
  let failed = ''
  useEditor.getState().transaction(tt('Cut {0} clips to the beat', clips.length), 'user', () => {
    const mark = savepoint()
    const stop = (why: string) => {
      failed = why
      if (mark) rollbackTo(mark)
    }
    // Out of the way first, so clips never overlap mid-move.
    const parking = Math.max(...Object.values(getProject().clips).map(clipEnd)) + fps * 10
    const parked = dispatch('clip.move', { moves: clips.map((c, k) => ({ id: c.id, start: parking + k * fps * 60 })), mode: 'free' })
    if (!parked.ok) return stop(parked.error)
    for (const c of clips) {
      if (i >= beats.length - 1) break
      const j = Math.min(beats.length - 1, i + every)
      const start = beats[i].frame
      let length = beats[j].frame - start
      const current = getProject().clips[c.id]
      // Media that runs out sooner ends early, on the last beat it reaches.
      const media = current.assetId ? sourceFrames(getProject(), current) : Infinity
      const available = Number.isFinite(media) ? (media - current.inPoint) / Math.max(0.01, current.speed) : Infinity
      // (The last clip the beats reach gets the beats that are left, and is said to have those.)
      let used = j - i
      if (length > available) {
        let k = i + 1
        while (k < j && beats[k].frame - start <= available) k++
        k = Math.max(i + 1, k - 1)
        length = beats[k].frame - start
        used = k - i
      }
      if (isMagneticTrack(getProject(), current.trackId)) {
        // The main track packs itself around whatever is put on it: the clip goes in, and ends on its beat.
        const moved = dispatch('clip.move', { moves: [{ id: c.id, start }], mode: 'free' })
        if (!moved.ok) return stop(moved.error)
        const cut = dispatch('clip.trim', { id: c.id, edge: 'end', frame: start + length })
        if (!cut.ok) return stop(cut.error)
      } else {
        // Cut to length where it is parked, then put on its beat. Moved at its full length, a clip longer than its
        // place has room for went to wherever it fitted instead.
        const cut = dispatch('clip.trim', { id: c.id, edge: 'end', frame: current.start + length })
        if (!cut.ok) return stop(cut.error)
        const moved = dispatch('clip.move', { moves: [{ id: c.id, start }], mode: 'free' })
        if (!moved.ok) return stop(moved.error)
        const now = getProject()
        const landed = now.clips[c.id]
        if (landed.start !== start) {
          const blocker = clipsOnTrack(now, landed.trackId).find((o) => o.id !== c.id && overlaps(start, start + length, o.start, clipEnd(o)))
          return stop(tt('“{0}” is in the way on {1}: there is no room there for “{2}” on the beat.', blocker?.name ?? '?', now.tracks.find((t) => t.id === landed.trackId)?.name ?? '', c.name))
        }
      }
      placed.push({ clip_id: c.id, start_seconds: Math.round((start / fps) * 1000) / 1000, beats: used })
      i += used
    }
    // The clips the beats ran out for follow the last one that got its beats, one after another, at the length
    // they have. They were left where they had been put out of the way: minutes past the end of the film.
    let cursor = placed.length ? clipEnd(getProject().clips[placed[placed.length - 1].clip_id]) : 0
    for (const c of clips) {
      if (placed.some((p) => p.clip_id === c.id)) continue
      const moved = dispatch('clip.move', { moves: [{ id: c.id, start: cursor }], mode: 'free' })
      if (!moved.ok) return stop(moved.error)
      cursor = clipEnd(getProject().clips[c.id])
    }
  })
  if (failed) throw new Error(failed)
  return { music: music.id, bpm: grid.bpm, placed }
}
