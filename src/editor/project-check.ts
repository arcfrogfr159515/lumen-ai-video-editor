/**
 * A project file is read back as whatever is in it: this build's work, an
 * older one's, a file edited by hand, one a sync tool merged, one cut short.
 * Loaded as it is, a wrong shape either throws somewhere in the middle of
 * drawing or — worse — works, and is saved back with the damage in it.
 *
 * So before a project is opened: what can't be a project is refused, with the
 * reason; what is a project with something wrong in it is repaired, and the
 * repairs are named so the user knows what was left out.
 */
import { uid } from '@/lib/id'
import type { Project } from './types'

export class ProjectError extends Error {}

const isPlain = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v)
const isFrame = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** The limits a picture can have: what a canvas can be made at. */
const SIZE = { min: 16, max: 16384 }
const DEFAULTS = { width: 1920, height: 1080, fps: 30, background: '#000000' }

/** One timeline's worth: settings, tracks, clips and markers. Returns what was repaired. */
function checkTimeline(t: Record<string, unknown>, assets: Record<string, unknown>, timelines: ReadonlySet<string>, what: string): string[] {
  const repairs: string[] = []
  // Mid-sentence, with the timeline's own name as it was written.
  const inside = what[0].toLowerCase() + what.slice(1)
  if (!Array.isArray(t.tracks)) throw new ProjectError(`${what} has no list of tracks.`)
  if (t.clips !== undefined && !isPlain(t.clips)) throw new ProjectError(`${what}’s clips aren’t in a form Lumen reads.`)
  if (t.markers !== undefined && !Array.isArray(t.markers)) throw new ProjectError(`${what}’s markers aren’t in a form Lumen reads.`)

  if (!isPlain(t.settings)) {
    t.settings = { ...DEFAULTS }
    repairs.push(`${what} had no settings: it is ${DEFAULTS.width}×${DEFAULTS.height} at ${DEFAULTS.fps} fps`)
  }
  const s = t.settings as Record<string, unknown>
  if (!(typeof s.fps === 'number' && Number.isFinite(s.fps) && s.fps > 0 && s.fps <= 1000)) {
    s.fps = DEFAULTS.fps
    repairs.push(`${what}’s frame rate couldn’t be read: it is ${DEFAULTS.fps} fps`)
  }
  for (const side of ['width', 'height'] as const) {
    const v = s[side]
    if (!(typeof v === 'number' && Number.isFinite(v) && v >= SIZE.min && v <= SIZE.max)) {
      s[side] = DEFAULTS[side]
      repairs.push(`${what}’s ${side} couldn’t be used: it is ${DEFAULTS[side]} px`)
    }
  }
  if (typeof s.background !== 'string') s.background = DEFAULTS.background

  const tracks = (t.tracks as unknown[]).filter((track): track is Record<string, unknown> => isPlain(track) && typeof track.id === 'string' && typeof track.kind === 'string')
  if (tracks.length !== (t.tracks as unknown[]).length) repairs.push(`${count((t.tracks as unknown[]).length - tracks.length, 'track')} in ${inside} couldn’t be read and ${(t.tracks as unknown[]).length - tracks.length === 1 ? 'was' : 'were'} left out`)
  t.tracks = tracks
  const trackIds = new Set(tracks.map((track) => track.id))

  let dropped = 0
  const clips = (t.clips ?? {}) as Record<string, unknown>
  for (const [id, clip] of Object.entries(clips)) {
    const ok =
      isPlain(clip) &&
      typeof clip.kind === 'string' &&
      isFrame(clip.start) &&
      isFrame(clip.duration) &&
      clip.duration > 0 &&
      (clip.inPoint === undefined || isFrame(clip.inPoint)) &&
      typeof clip.trackId === 'string' &&
      trackIds.has(clip.trackId) &&
      // What a clip plays has to be there to play: its media, or the timeline nested in it.
      (clip.assetId === undefined || (typeof clip.assetId === 'string' && clip.assetId in assets)) &&
      (clip.sequenceId === undefined || (typeof clip.sequenceId === 'string' && timelines.has(clip.sequenceId)))
    if (!ok) {
      delete clips[id]
      dropped++
      continue
    }
    const c = clip as Record<string, unknown>
    c.id = id
    if ((c.start as number) < 0) c.start = 0
  }
  if (dropped) repairs.push(`${count(dropped, 'clip')} in ${inside} couldn’t be read and ${dropped === 1 ? 'was' : 'were'} left out`)

  if (Array.isArray(t.markers)) {
    const markers = t.markers.filter((m) => isPlain(m) && isFrame(m.frame))
    if (markers.length !== t.markers.length) repairs.push(`${count(t.markers.length - markers.length, 'marker')} in ${inside} couldn’t be read and ${t.markers.length - markers.length === 1 ? 'was' : 'were'} left out`)
    t.markers = markers
  }
  return repairs
}

/**
 * Checks what a project file held. Throws ProjectError when it isn't a
 * project; otherwise returns it (repaired in place) with what was repaired.
 */
export function checkProject(data: unknown): { project: Project; repairs: string[] } {
  if (!isPlain(data)) throw new ProjectError('The file doesn’t hold a project.')
  if (data.assets !== undefined && !isPlain(data.assets)) throw new ProjectError('The project’s media list isn’t in a form Lumen reads.')
  if (data.sequences !== undefined && !isPlain(data.sequences)) throw new ProjectError('The project’s other timelines aren’t in a form Lumen reads.')
  const repairs: string[] = []
  if (typeof data.id !== 'string' || !data.id) {
    // Its history and its chats are kept by this: a project without one starts them afresh.
    data.id = uid('project')
    repairs.push('the project had no id: it has a new one, so its version history starts afresh')
  }
  if (typeof data.name !== 'string' || !data.name) data.name = 'Untitled'
  const assets = (data.assets ?? {}) as Record<string, unknown>
  for (const [id, asset] of Object.entries(assets)) {
    if (!isPlain(asset) || !isPlain(asset.source) || typeof asset.kind !== 'string') delete assets[id]
    else asset.id = id
  }
  const others = (data.sequences ?? {}) as Record<string, unknown>
  for (const [id, sequence] of Object.entries(others)) if (!isPlain(sequence)) delete others[id]
  // Every timeline a clip can be a nest of: the others, and the open one (a timeline that isn't open may hold it).
  const open = isPlain(data.sequence) && typeof data.sequence.id === 'string' ? [data.sequence.id] : []
  const timelines = new Set([...Object.keys(others), ...open])
  repairs.push(...checkTimeline(data, assets, timelines, 'The timeline'))
  for (const [id, sequence] of Object.entries(others)) {
    const s = sequence as Record<string, unknown>
    s.id = id
    repairs.push(...checkTimeline(s, assets, timelines, `The timeline “${typeof s.name === 'string' ? s.name : id}”`))
  }
  return { project: data as unknown as Project, repairs }
}
