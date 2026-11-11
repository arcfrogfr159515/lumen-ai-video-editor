/**
 * What colour a clip is on the timeline. By default that says what kind of
 * clip it is; a project can colour by where the footage came from, who is
 * speaking or which camera it is instead — automatically, by rules, or with a
 * label set on the clip by hand (which always wins).
 */
import { hashString } from '@/lib/math'
import { angleTracks } from './sequences'
import { consumed } from './timing'
import type { Asset, Clip, ClipColoring, ColorRule, ColorRuleField, LabelColor, Project } from './types'
import { tt } from '@/lib/i18n'

export const LABEL_COLORS: { id: LabelColor; name: string; css: string }[] = [
  { id: 'red', name: tt('Red'), css: '#ef5b5b' },
  { id: 'orange', name: tt('Orange'), css: '#f08c3a' },
  { id: 'yellow', name: tt('Yellow'), css: '#e6c229' },
  { id: 'green', name: tt('Green'), css: '#4cc26a' },
  { id: 'teal', name: tt('Teal'), css: '#2bb8a6' },
  { id: 'blue', name: tt('Blue'), css: '#4c8dff' },
  { id: 'purple', name: tt('Purple'), css: '#9a6bff' },
  { id: 'pink', name: tt('Pink'), css: '#ee6fb4' },
  { id: 'gray', name: tt('Gray'), css: '#8d8f88' },
]

const CSS = new Map(LABEL_COLORS.map((c) => [c.id, c.css]))

export const labelCss = (color: LabelColor) => CSS.get(color) ?? '#8d8f88'

/** The colours automatic colouring hands out (gray is kept for clips that have nothing to go by). */
const AUTO: LabelColor[] = ['blue', 'orange', 'green', 'purple', 'yellow', 'teal', 'pink', 'red']

export const COLOR_FIELDS: { id: ColorRuleField; label: string; hint: string; placeholder: string }[] = [
  { id: 'source', label: tt('Source'), hint: tt('The media a clip plays: part of its file name, or its id'), placeholder: 'interview_cam_a' },
  { id: 'speaker', label: tt('Speaker'), hint: tt('Who is speaking in the clip'), placeholder: tt('Anna') },
  { id: 'angle', label: tt('Camera'), hint: tt('The angle a multicam clip shows: its number or name'), placeholder: '2' },
  { id: 'track', label: tt('Track'), hint: tt('The track a clip is on'), placeholder: tt('Overlay') },
  { id: 'name', label: tt('Clip name'), hint: tt('Part of the clip’s name'), placeholder: 'b-roll' },
  { id: 'tag', label: tt('Media tag'), hint: tt('A tag on the clip’s media'), placeholder: 'drone' },
  { id: 'kind', label: tt('Kind'), hint: tt('video, image, audio, text or adjustment'), placeholder: 'text' },
]

export const AUTO_MODES: { id: NonNullable<ClipColoring['auto']>; label: string; hint: string }[] = [
  { id: 'source', label: tt('Source'), hint: tt('Every media item gets its own colour') },
  { id: 'speaker', label: tt('Speaker'), hint: tt('Every speaker gets their own colour') },
  { id: 'angle', label: tt('Camera'), hint: tt('Every camera angle gets its own colour') },
  { id: 'track', label: tt('Track'), hint: tt('Every track gets its own colour') },
]

type Scope = Pick<Project, 'assets' | 'tracks' | 'sequences'>

/** Who speaks in a clip: said on the clip, else the one voice its media's cue sheet names for the stretch it plays. */
export function speakerOf(project: Pick<Project, 'assets'> & { settings?: Project['settings'] }, clip: Clip): string | undefined {
  if (clip.speaker?.trim()) return clip.speaker.trim()
  const asset = clip.assetId ? project.assets[clip.assetId] : undefined
  if (!asset) return undefined
  const tagged = asset.tags?.map((t) => /^speaker\s*[:=]\s*(.+)$/i.exec(t)?.[1]?.trim()).find(Boolean)
  if (tagged) return tagged
  if (!asset.cues?.length) return undefined
  const fps = project.settings?.fps ?? 30
  const from = clip.inPoint / fps
  const to = from + consumed(clip) / fps
  const who = new Map<string, number>()
  for (const cue of asset.cues) {
    if (!cue.who || cue.at >= to || cue.at + (cue.seconds ?? 0) < from) continue
    who.set(cue.who, (who.get(cue.who) ?? 0) + (cue.seconds ?? 1))
  }
  let best: string | undefined
  let most = 0
  for (const [name, weight] of who) if (weight > most) [best, most] = [name, weight]
  return best
}

/** The angle a multicam clip shows: its number (from 1) and the camera's name. */
export function angleOf(project: Pick<Project, 'sequences'>, clip: Clip): { index: number; name: string; id: string } | undefined {
  const seq = clip.sequenceId ? project.sequences?.[clip.sequenceId] : undefined
  if (!seq?.multicam) return undefined
  const angles = angleTracks(seq)
  const i = Math.max(
    0,
    angles.findIndex((t) => t.id === clip.angle),
  )
  return angles[i] ? { index: i + 1, name: angles[i].name, id: angles[i].id } : undefined
}

/** What a field reads on a clip: the texts a rule's value is matched against, and the key automatic colouring groups by. */
function fieldValues(project: Scope & { settings?: Project['settings'] }, clip: Clip, field: ColorRuleField): { texts: string[]; key?: string } {
  const asset: Asset | undefined = clip.assetId ? project.assets[clip.assetId] : undefined
  switch (field) {
    case 'source': {
      if (clip.sequenceId) {
        const seq = project.sequences?.[clip.sequenceId]
        return { texts: [clip.sequenceId, seq?.name ?? ''], key: `seq:${clip.sequenceId}` }
      }
      if (!asset) return { texts: [] }
      const file = asset.source.type === 'file' ? asset.source.fileName : asset.source.pattern
      return { texts: [asset.id, asset.name, file], key: `asset:${asset.id}` }
    }
    case 'speaker': {
      const who = speakerOf(project, clip)
      return who ? { texts: [who], key: who.toLowerCase() } : { texts: [] }
    }
    case 'angle': {
      const angle = angleOf(project, clip)
      return angle ? { texts: [String(angle.index), angle.name], key: `${clip.sequenceId}:${angle.id}` } : { texts: [] }
    }
    case 'track': {
      const track = project.tracks.find((t) => t.id === clip.trackId)
      return track ? { texts: [track.name], key: track.id } : { texts: [] }
    }
    case 'name':
      return { texts: [clip.name, clip.text?.content ?? ''] }
    case 'tag':
      return { texts: asset?.tags ?? [] }
    case 'kind':
      return { texts: [clip.kind] }
  }
}

/** Whether a rule applies to a clip. */
export function ruleMatches(project: Scope & { settings?: Project['settings'] }, clip: Clip, rule: Pick<ColorRule, 'field' | 'value'>) {
  const { texts } = fieldValues(project, clip, rule.field)
  const want = rule.value.trim().toLowerCase()
  const have = texts.filter(Boolean).map((t) => t.toLowerCase())
  if (!have.length || !want) return false
  if (want === '*') return true
  // Ids, kinds and angle numbers must match whole; names match in part.
  if (rule.field === 'kind') return have.includes(want)
  if (rule.field === 'angle') return have.includes(want) || have.slice(1).some((t) => t.includes(want))
  return have.some((t) => t === want || t.includes(want))
}

/**
 * Colours for automatic colouring: every distinct value gets one, in the order
 * the values first appear on the timeline, so the first eight never share a
 * colour and nothing changes colour when clips are merely moved around…
 * until there are more values than colours.
 */
const autoCache = new WeakMap<Record<string, Clip>, { assets: unknown; tracks: unknown; sequences: unknown; byField: Map<string, Map<string, LabelColor>> }>()

function autoColors(project: Scope & Pick<Project, 'clips'> & { settings?: Project['settings'] }, field: NonNullable<ClipColoring['auto']>) {
  // Immer hands out new objects whenever something changes, so identity says whether the colours still hold.
  let entry = autoCache.get(project.clips)
  if (!entry || entry.assets !== project.assets || entry.tracks !== project.tracks || entry.sequences !== project.sequences) {
    entry = { assets: project.assets, tracks: project.tracks, sequences: project.sequences, byField: new Map() }
    autoCache.set(project.clips, entry)
  }
  const byField = entry.byField
  const cacheKey = field
  const hit = byField.get(cacheKey)
  if (hit) return hit
  const order = new Map(project.tracks.map((t, i) => [t.id, i]))
  const keys: string[] = []
  const seen = new Set<string>()
  const clips = Object.values(project.clips).sort((a, b) => a.start - b.start || (order.get(a.trackId) ?? 0) - (order.get(b.trackId) ?? 0))
  // Tracks keep the order they are stacked in; everything else the order it first plays.
  if (field === 'track') for (const t of project.tracks) keys.push(t.id)
  else
    for (const c of clips) {
      const key = fieldValues(project, c, field).key
      if (key && !seen.has(key)) {
        seen.add(key)
        keys.push(key)
      }
    }
  const map = new Map<string, LabelColor>()
  keys.forEach((key, i) => map.set(key, i < AUTO.length ? AUTO[i] : AUTO[hashString(key) % AUTO.length]))
  byField.set(cacheKey, map)
  return map
}

export interface ClipTint {
  color: LabelColor
  css: string
  /** Where the colour came from, for a tooltip. */
  from: 'label' | 'rule' | 'auto'
  /** The rule's field and value, or the value automatic colouring grouped by. */
  why?: string
}

/** The colour a clip is given, or null when it keeps the colour of its kind. */
export function clipTint(project: Scope & Pick<Project, 'clips' | 'clipColors'> & { settings?: Project['settings'] }, clip: Clip): ClipTint | null {
  if (clip.label) return { color: clip.label, css: labelCss(clip.label), from: 'label' }
  const coloring = project.clipColors
  if (!coloring) return null
  for (const rule of coloring.rules) {
    if (ruleMatches(project, clip, rule)) return { color: rule.color, css: labelCss(rule.color), from: 'rule', why: `${rule.field} “${rule.value}”` }
  }
  if (!coloring.auto) return null
  const { key, texts } = fieldValues(project, clip, coloring.auto)
  if (!key) return null
  const color = autoColors(project, coloring.auto).get(key)
  return color ? { color, css: labelCss(color), from: 'auto', why: texts.find(Boolean) } : null
}

/** What automatic colouring shows as a legend: each value and its colour, in order. */
export function colorLegend(project: Scope & Pick<Project, 'clips' | 'clipColors'> & { settings?: Project['settings'] }): { label: string; color: LabelColor; clips: number }[] {
  const rows = new Map<string, { label: string; color: LabelColor; clips: number }>()
  for (const clip of Object.values(project.clips)) {
    const tint = clipTint(project, clip)
    if (!tint) continue
    const label = tint.from === 'label' ? tt('Labelled by hand') : (tint.why ?? '')
    const key = `${tint.from}|${label}|${tint.color}`
    const row = rows.get(key)
    if (row) row.clips++
    else rows.set(key, { label, color: tint.color, clips: 1 })
  }
  return [...rows.values()]
}
