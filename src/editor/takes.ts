/**
 * Alternate takes. A clip can hold several candidates for its place — other
 * takes of the same line, other pieces of B-roll — and switch between them
 * where it stands: the place, its length and everything done to it stay, only
 * the footage changes. Trying an alternative is one keystroke, not a drag.
 */
import { uid } from '@/lib/id'
import { clipEnd, clipsOnTrack, fitToMedia, framesIn, isMagneticTrack, sourceFrames, trackAccepts } from './ops'
import { MAX_SPEED, MIN_SPEED } from './timing'
import type { Asset, Clip, ClipTake, Frame, Project } from './types'
import { tt } from '@/lib/i18n'

export class TakeError extends Error {}

/** Clips that play footage a take could replace (titles and adjustment layers have none). */
export const canHaveTakes = (clip: Pick<Clip, 'kind' | 'freeze'>): clip is Clip & { kind: ClipTake['kind'] } => (clip.kind === 'video' || clip.kind === 'image' || clip.kind === 'audio') && !clip.freeze

/** What a clip plays now, as a take. */
export function takeOf(clip: Clip, id = uid('take')): ClipTake {
  return {
    id,
    name: clip.name,
    kind: clip.kind as ClipTake['kind'],
    ...(clip.assetId ? { assetId: clip.assetId } : {}),
    ...(clip.sequenceId ? { sequenceId: clip.sequenceId } : {}),
    ...(clip.angle ? { angle: clip.angle } : {}),
    inPoint: clip.inPoint,
    speed: clip.speed,
    reverse: clip.reverse,
    ...(clip.keyframes.speed?.length ? { ramp: clip.keyframes.speed.map((k) => ({ ...k })) } : {}),
    ...(clip.matte ? { matte: { ...clip.matte } } : {}),
    ...(clip.stabilize ? { stabilize: { ...clip.stabilize, path: [...clip.stabilize.path] } } : {}),
  }
}

/** The clip's takes with the one showing brought up to date (it may have been slipped or re-timed since). */
export function currentTakes(clip: Clip): ClipTake[] {
  if (!clip.takes?.length) return []
  return clip.takes.map((t) => (t.id === clip.takeId ? takeOf(clip, t.id) : t))
}

export const takeIndex = (clip: Pick<Clip, 'takes' | 'takeId'>) => Math.max(0, clip.takes?.findIndex((t) => t.id === clip.takeId) ?? 0)

/** The take `step` places along from the one showing, wrapping round. */
export function neighbourTake(clip: Pick<Clip, 'takes' | 'takeId'>, step: number): ClipTake | undefined {
  const n = clip.takes?.length ?? 0
  if (n < 2) return undefined
  return clip.takes![(((takeIndex(clip) + step) % n) + n) % n]
}

/** Source frames a take has from its in-point on (Infinity for stills). */
function footageAfter(p: Project, take: ClipTake) {
  const src = sourceFrames(p, take)
  return src === Infinity ? Infinity : Math.max(0, src - take.inPoint)
}

/** The longest a clip showing this take can be, in timeline frames (ramps are judged by their fastest part being unknown: by the base speed). */
function longest(p: Project, take: ClipTake) {
  const frames = footageAfter(p, take)
  return frames === Infinity ? Infinity : Math.floor(frames / take.speed + 1e-6)
}

export interface AddTakeInput {
  assetId: string
  /** Where in the media the take starts, in project frames (default: its start). */
  inPoint?: Frame
  name?: string
  speed?: number
}

/**
 * Adds a media item as a take of a clip (a draft). The clip's own footage
 * becomes its first take the first time. Returns the new take's id.
 */
export function addTake(p: Project, clip: Clip, input: AddTakeInput): string {
  if (!canHaveTakes(clip)) throw new TakeError(clip.freeze ? tt('A freeze frame holds one frame — it has no takes') : tt('“{0}” has no footage to swap — takes are for video, image and audio clips', clip.name))
  const asset: Asset | undefined = p.assets[input.assetId]
  if (!asset) throw new TakeError(tt('Asset {0} not found', input.assetId))
  const track = p.tracks.find((t) => t.id === clip.trackId)
  if (track && !trackAccepts(track, asset.kind)) throw new TakeError(tt('“{0}” is {1} — it can’t be a take of a clip on {2} track', asset.name, asset.kind === 'audio' ? tt('sound') : tt('a picture'), track.kind === 'audio' ? tt('an audio') : tt('a video')))
  const total = asset.duration !== undefined ? framesIn(asset.duration, p.settings.fps) : Infinity
  const inPoint = Math.max(0, Math.min(Math.round(input.inPoint ?? 0), total === Infinity ? Infinity : Math.max(0, total - 1)))
  if (!clip.takes?.length) {
    // A take is named after its footage, so a clip that was given a name of its own is told apart from one that wasn't.
    const footage = clip.sequenceId ? p.sequences?.[clip.sequenceId]?.name : clip.assetId ? p.assets[clip.assetId]?.name : undefined
    const first = { ...takeOf(clip), name: footage ?? clip.name }
    clip.takes = [first]
    clip.takeId = first.id
  }
  const take: ClipTake = {
    id: uid('take'),
    name: input.name?.trim() || asset.name,
    kind: asset.kind,
    assetId: asset.id,
    inPoint,
    speed: Math.min(MAX_SPEED, Math.max(MIN_SPEED, input.speed ?? 1)),
    reverse: false,
  }
  clip.takes.push(take)
  return take.id
}

export interface SwitchResult {
  takeId: string
  /** Frames the clip got shorter by, when the take hasn't the footage to fill the place. */
  shortenedBy: number
  /** The take's in-point was moved this many frames earlier so it could fill the place. */
  slidBack: number
}

/**
 * Shows another take in the clip's place (a draft). The clip keeps its start
 * and, when the take has the footage, its length: a take that starts too near
 * the end of its media starts earlier instead, and one that is too short
 * altogether makes the clip shorter — its old length is remembered and comes
 * back with the next take that can fill it.
 */
export function switchTake(p: Project, clip: Clip, takeId: string): SwitchResult {
  const takes = clip.takes
  const target = takes?.find((t) => t.id === takeId)
  if (!takes || !target) throw new TakeError(tt('“{0}” has no take {1}', clip.name, takeId))
  if (target.id === clip.takeId) return { takeId, shortenedBy: 0, slidBack: 0 }
  if (target.assetId && !p.assets[target.assetId]) throw new TakeError(tt('The media of take “{0}” isn’t in this project any more', target.name))
  if (target.sequenceId && !p.sequences?.[target.sequenceId]) throw new TakeError(tt('The timeline of take “{0}” isn’t in this project any more', target.name))

  // What is showing may have been slipped or re-timed: put it away as it is now.
  const showing = takes.findIndex((t) => t.id === clip.takeId)
  const renamed = showing < 0 || clip.name !== takes[showing].name
  if (showing >= 0) takes[showing] = { ...takeOf(clip, takes[showing].id), name: takes[showing].name }

  const slot = clip.takeSlot ?? clip.duration
  // On a track that doesn't close up, the place ends where the next clip begins.
  const next = isMagneticTrack(p, clip.trackId) ? undefined : clipsOnTrack(p, clip.trackId).find((c) => c.id !== clip.id && c.start >= clipEnd(clip))
  const room = next ? next.start - clip.start : Infinity
  const want = Math.min(slot, room)

  let inPoint = target.inPoint
  let slidBack = 0
  const src = sourceFrames(p, target)
  if (src !== Infinity && !target.reverse && !target.ramp) {
    const need = Math.ceil(want * target.speed - 1e-6)
    if (src - inPoint < need) {
      const earlier = Math.max(0, src - need)
      slidBack = inPoint - earlier
      inPoint = earlier
    }
  }
  const fits = longest(p, { ...target, inPoint })
  const duration = Math.max(1, Math.min(want, fits))

  clip.kind = target.kind
  if (target.assetId) clip.assetId = target.assetId
  else delete clip.assetId
  if (target.sequenceId) clip.sequenceId = target.sequenceId
  else delete clip.sequenceId
  if (target.angle) clip.angle = target.angle
  else delete clip.angle
  clip.inPoint = inPoint
  clip.speed = target.speed
  clip.reverse = target.reverse
  if (target.ramp?.length) clip.keyframes.speed = target.ramp.map((k) => ({ ...k }))
  else delete clip.keyframes.speed
  // A clip named after its footage takes the new footage's name; one given a name of its own keeps it.
  if (!renamed) clip.name = target.name
  // A subject matte and stabilization were measured on one piece of footage: they go and come back with it.
  if (target.matte) clip.matte = { ...target.matte }
  else delete clip.matte
  if (target.stabilize) clip.stabilize = { ...target.stabilize, path: [...target.stabilize.path] }
  else delete clip.stabilize

  clip.duration = duration
  // A ramp can use footage faster than its base speed says: the clip ends where the footage does.
  fitToMedia(p, clip)
  if (clip.duration < slot) clip.takeSlot = slot
  else delete clip.takeSlot
  // Keyframes past the new end have nothing to animate.
  for (const [prop, kfs] of Object.entries(clip.keyframes)) {
    if (prop === 'speed' || !kfs) continue
    const kept = kfs.filter((k) => k.frame <= clip.duration)
    if (kept.length) clip.keyframes[prop as keyof Clip['keyframes']] = kept
    else delete clip.keyframes[prop as keyof Clip['keyframes']]
  }
  clip.audio.fadeIn = Math.min(clip.audio.fadeIn, Math.floor(clip.duration / 2))
  clip.audio.fadeOut = Math.min(clip.audio.fadeOut, Math.floor(clip.duration / 2))
  clip.takeId = target.id
  return { takeId: target.id, shortenedBy: Math.max(0, want - clip.duration), slidBack }
}

/**
 * Takes a candidate off a clip (a draft). Removing the one showing shows the
 * one before it first; a clip left with a single take is a plain clip again.
 */
export function removeTake(p: Project, clip: Clip, takeId: string) {
  const takes = clip.takes
  if (!takes?.some((t) => t.id === takeId)) throw new TakeError(tt('“{0}” has no take {1}', clip.name, takeId))
  if (takes.length > 1 && clip.takeId === takeId) {
    const i = takes.findIndex((t) => t.id === takeId)
    switchTake(p, clip, takes[i > 0 ? i - 1 : 1].id)
  }
  clip.takes = takes.filter((t) => t.id !== takeId)
  if (clip.takes.length <= 1) clearTakes(clip)
}

/** Keeps what is showing and forgets the other candidates. */
export function clearTakes(clip: Clip) {
  delete clip.takes
  delete clip.takeId
  delete clip.takeSlot
}

/** For a list: where a take's footage comes from and how much of it there is. */
export function describeTake(p: Pick<Project, 'assets' | 'sequences' | 'settings'>, take: ClipTake): { source: string; seconds: number | null; missing: boolean } {
  const fps = p.settings.fps
  if (take.sequenceId) {
    const seq = p.sequences?.[take.sequenceId]
    return { source: seq ? tt('Timeline “{0}”', seq.name) : tt('Missing timeline'), seconds: null, missing: !seq }
  }
  const asset = take.assetId ? p.assets[take.assetId] : undefined
  if (!asset) return { source: tt('Missing media'), seconds: null, missing: true }
  const from = take.inPoint / fps
  return { source: asset.name, seconds: asset.duration !== undefined ? Math.max(0, asset.duration - from) : null, missing: asset.source.type === 'file' && Boolean(asset.source.missing) }
}

/** How much footage the clip is using of what its take has: for the “too short” warning in a list. */
export const takeFills = (p: Project, clip: Clip, take: ClipTake) => longest(p, take) >= (clip.takeSlot ?? clip.duration)

