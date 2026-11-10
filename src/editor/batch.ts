/**
 * Batch operations: one change made to many clips at once, where the change
 * is not "make them all the same" — louder by 3 dB each, half as fast each,
 * named in sequence. Which clips an operation applies to, the names a pattern
 * makes, and ways of picking clips that belong together.
 */
import { formatTimecode } from '@/lib/time'
import type { Clip, Project } from './types'

/** What a batch can change, as the batch command and its panel name them. */
export type BatchField = 'speed' | 'volume' | 'fades' | 'opacity' | 'scale' | 'reverse' | 'blend' | 'effects' | 'label' | 'rename'

/** Why an operation leaves a clip alone, in a few words — or null when it applies. */
export function batchSkip(project: Pick<Project, 'assets'>, clip: Clip, field: BatchField): string | null {
  const media = clip.kind === 'video' || clip.kind === 'audio'
  const visual = clip.kind !== 'audio'
  switch (field) {
    case 'speed':
    case 'reverse':
      if (!media) return 'no speed to change'
      if (clip.freeze) return 'a freeze frame'
      return null
    case 'volume':
    case 'fades': {
      if (!media) return 'no sound'
      if (clip.kind === 'video') {
        if (clip.audio.detached) return 'its sound is on its own clip'
        const asset = clip.assetId ? project.assets[clip.assetId] : undefined
        if (!clip.sequenceId && asset?.hasAudio === false) return 'no sound'
      }
      return null
    }
    case 'opacity':
    case 'scale':
    case 'blend':
      if (!visual) return 'no picture'
      if (field !== 'opacity' && clip.kind === 'adjustment') return 'an adjustment layer'
      return null
    case 'effects':
      return visual ? null : 'no picture'
    case 'label':
    case 'rename':
      return null
  }
}

// ─── Renaming ────────────────────────────────────────────────────────────

/** What a rename pattern can hold. */
export const RENAME_TOKENS: { token: string; means: string }[] = [
  { token: '{n}', means: 'its number among the clips, in timeline order' },
  { token: '{nn}', means: 'the same, with a leading zero' },
  { token: '{name}', means: 'the name it has now' },
  { token: '{source}', means: 'the name of its media' },
  { token: '{track}', means: 'the track it is on' },
  { token: '{tc}', means: 'the timecode it starts at' },
]

/**
 * The names a pattern gives a set of clips, numbered in timeline order (then
 * top track first). Null for a pattern that comes out empty.
 */
export function batchNames(project: Pick<Project, 'clips' | 'tracks' | 'assets' | 'sequences' | 'settings'>, ids: readonly string[], pattern: string): Map<string, string> | null {
  const order = new Map(project.tracks.map((t, i) => [t.id, i]))
  const clips = ids
    .map((id) => project.clips[id])
    .filter(Boolean)
    .sort((a, b) => a.start - b.start || (order.get(a.trackId) ?? 0) - (order.get(b.trackId) ?? 0))
  const width = Math.max(2, String(clips.length).length)
  const out = new Map<string, string>()
  clips.forEach((clip, i) => {
    const asset = clip.assetId ? project.assets[clip.assetId] : undefined
    const source = clip.sequenceId ? (project.sequences?.[clip.sequenceId]?.name ?? clip.name) : (asset?.name ?? clip.name)
    const name = pattern
      .replace(/\{nn\}/g, String(i + 1).padStart(width, '0'))
      .replace(/\{n\}/g, String(i + 1))
      .replace(/\{name\}/g, clip.name)
      .replace(/\{source\}/g, source)
      .replace(/\{track\}/g, project.tracks.find((t) => t.id === clip.trackId)?.name ?? '')
      .replace(/\{tc\}/g, formatTimecode(clip.start, project.settings.fps))
      .replace(/\s+/g, ' ')
      .trim()
    if (name) out.set(clip.id, name.slice(0, 120))
  })
  return out.size ? out : null
}

// ─── Picking clips that belong together ──────────────────────────────────

export type SimilarBy = 'track' | 'source' | 'kind' | 'label' | 'speaker'

export const SIMILAR: { id: SimilarBy; label: string }[] = [
  { id: 'track', label: 'On the same tracks' },
  { id: 'source', label: 'From the same media' },
  { id: 'kind', label: 'Of the same kind' },
  { id: 'label', label: 'With the same label' },
  { id: 'speaker', label: 'With the same speaker' },
]

/** Every clip (on unlocked tracks) that shares something with the clips given: the same track, media, kind, label or speaker. */
export function similarClips(project: Pick<Project, 'clips' | 'tracks'>, ids: readonly string[], by: SimilarBy): string[] {
  const picked = ids.map((id) => project.clips[id]).filter(Boolean)
  const key = (c: Clip): string | undefined => {
    switch (by) {
      case 'track':
        return c.trackId
      case 'source':
        return c.sequenceId ? `seq:${c.sequenceId}` : c.assetId
      case 'kind':
        return c.kind
      case 'label':
        return c.label
      case 'speaker':
        return c.speaker?.toLowerCase()
    }
  }
  const wanted = new Set(picked.map(key).filter((k): k is string => Boolean(k)))
  if (!wanted.size) return [...ids]
  const locked = new Set(project.tracks.filter((t) => t.locked).map((t) => t.id))
  return Object.values(project.clips)
    .filter((c) => !locked.has(c.trackId) && wanted.has(key(c) ?? ''))
    .sort((a, b) => a.start - b.start)
    .map((c) => c.id)
}

/** What a batch did, for a toast: how many clips changed, and why the rest were left. */
export function describeBatch(result: { changed: number; skipped: { name: string; why: string }[] }): { title: string; description?: string } {
  const n = result.changed
  const title = n ? `Changed ${n} clip${n === 1 ? '' : 's'}` : 'Nothing changed'
  if (!result.skipped.length) return { title }
  const reasons = new Map<string, number>()
  for (const s of result.skipped) reasons.set(s.why, (reasons.get(s.why) ?? 0) + 1)
  const parts = [...reasons].map(([why, count]) => `${count === 1 ? `“${result.skipped.find((s) => s.why === why)!.name}”` : `${count} clips`} (${why})`)
  return { title, description: `Left alone: ${parts.join(', ')}.` }
}
