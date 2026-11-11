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
import { counted, tt } from '@/lib/i18n'

export class ProjectError extends Error {}

const isPlain = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v)
const isFrame = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const count = counted

/** The limits a picture can have: what a canvas can be made at. */
const SIZE = { min: 16, max: 16384 }
const DEFAULTS = { width: 1920, height: 1080, fps: 30, background: '#000000' }

/** One timeline's worth: settings, tracks, clips and markers. Returns what was repaired. */
function checkTimeline(t: Record<string, unknown>, assets: Record<string, unknown>, timelines: ReadonlySet<string>, what: string): string[] {
  const repairs: string[] = []
  // Mid-sentence, with the timeline's own name as it was written.
  const inside = what[0].toLowerCase() + what.slice(1)
  if (!Array.isArray(t.tracks)) throw new ProjectError(tt('{0} has no list of tracks.', what))
  if (t.clips !== undefined && !isPlain(t.clips)) throw new ProjectError(tt('{0}’s clips aren’t in a form Lumen reads.', what))
  if (t.markers !== undefined && !Array.isArray(t.markers)) throw new ProjectError(tt('{0}’s markers aren’t in a form Lumen reads.', what))

  if (!isPlain(t.settings)) {
    t.settings = { ...DEFAULTS }
    repairs.push(tt('{0} had no settings: it is {1}×{2} at {3} fps', what, DEFAULTS.width, DEFAULTS.height, DEFAULTS.fps))
  }
  const s = t.settings as Record<string, unknown>
  if (!(typeof s.fps === 'number' && Number.isFinite(s.fps) && s.fps > 0 && s.fps <= 1000)) {
    s.fps = DEFAULTS.fps
    repairs.push(tt('{0}’s frame rate couldn’t be read: it is {1} fps', what, DEFAULTS.fps))
  }
  for (const side of ['width', 'height'] as const) {
    const v = s[side]
    if (!(typeof v === 'number' && Number.isFinite(v) && v >= SIZE.min && v <= SIZE.max)) {
      s[side] = DEFAULTS[side]
      repairs.push(tt('{0}’s {1} couldn’t be used: it is {2} px', what, side, DEFAULTS[side]))
    }
  }
  if (typeof s.background !== 'string') s.background = DEFAULTS.background

  const tracks = (t.tracks as unknown[]).filter((track): track is Record<string, unknown> => isPlain(track) && typeof track.id === 'string' && typeof track.kind === 'string')
  if (tracks.length !== (t.tracks as unknown[]).length) repairs.push(tt('{0} in {1} couldn’t be read and {2} left out', count((t.tracks as unknown[]).length - tracks.length, 'track'), inside, (t.tracks as unknown[]).length - tracks.length === 1 ? tt('was') : tt('were')))
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
  if (dropped) repairs.push(tt('{0} in {1} couldn’t be read and {2} left out', count(dropped, 'clip'), inside, dropped === 1 ? tt('was') : tt('were')))

  if (Array.isArray(t.markers)) {
    const markers = t.markers.filter((m) => isPlain(m) && isFrame(m.frame))
    if (markers.length !== t.markers.length) repairs.push(tt('{0} in {1} couldn’t be read and {2} left out', count(t.markers.length - markers.length, 'marker'), inside, t.markers.length - markers.length === 1 ? tt('was') : tt('were')))
    t.markers = markers
  }
  return repairs
}

/**
 * Checks what a project file held. Throws ProjectError when it isn't a
 * project; otherwise returns it (repaired in place) with what was repaired.
 */
export function checkProject(data: unknown): { project: Project; repairs: string[] } {
  if (!isPlain(data)) throw new ProjectError(tt('The file doesn’t hold a project.'))
  if (data.assets !== undefined && !isPlain(data.assets)) throw new ProjectError(tt('The project’s media list isn’t in a form Lumen reads.'))
  if (data.sequences !== undefined && !isPlain(data.sequences)) throw new ProjectError(tt('The project’s other timelines aren’t in a form Lumen reads.'))
  const repairs: string[] = []
  if (typeof data.id !== 'string' || !data.id) {
    // Its history and its chats are kept by this: a project without one starts them afresh.
    data.id = uid('project')
    repairs.push(tt('the project had no id: it has a new one, so its version history starts afresh'))
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
  repairs.push(...checkTimeline(data, assets, timelines, tt('The timeline')))
  for (const [id, sequence] of Object.entries(others)) {
    const s = sequence as Record<string, unknown>
    s.id = id
    repairs.push(...checkTimeline(s, assets, timelines, tt('The timeline “{0}”', typeof s.name === 'string' ? s.name : id)))
  }
  return { project: data as unknown as Project, repairs }
}
