/**
 * What must hold for any timeline, whatever was done to it — and the pieces
 * tests need to throw random edits at one: a seeded generator, so a failing
 * run can be run again, and a project with media of a few lengths.
 */
import { clipEnd, clipsOnTrack, isMagnetic, sourceFrames, trackAccepts } from './ops'
import { addAsset, freshProject } from './test-helpers'
import { consumed } from './timing'
import type { Project } from './types'
/** A small seeded generator. */
export function rng(seed: number) {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const int = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1))
  const pick = <T>(items: readonly T[]): T => items[int(0, items.length - 1)]
  const chance = (p: number) => next() < p
  return { next, int, pick, chance }
}

export type Rng = ReturnType<typeof rng>

/** The media of a test project, and how many seconds each runs. */
export const MEDIA = { v1: 60, v2: 40, v3: 8, a1: 120, a2: 30 }

export function setUp() {
  freshProject('Fuzz')
  addAsset('v1', MEDIA.v1)
  addAsset('v2', MEDIA.v2)
  addAsset('v3', MEDIA.v3)
  addAsset('a1', MEDIA.a1, 'audio')
  addAsset('a2', MEDIA.a2, 'audio')
  addAsset('still', 0, 'image')
}

// ─── What must always hold ───────────────────────────────────────────────

/** Everything wrong with a timeline, in words (empty when it is sound). */
export function problems(p: Project): string[] {
  const out: string[] = []
  const tracks = new Map(p.tracks.map((t) => [t.id, t]))
  for (const c of Object.values(p.clips)) {
    const where = `${c.name} (${c.id}) at ${c.start}+${c.duration}`
    const track = tracks.get(c.trackId)
    if (!track) out.push(`${where}: on a track that isn't there`)
    else if (!trackAccepts(track, c.kind)) out.push(`${where}: a ${c.kind} clip on ${track.name}`)
    if (!Number.isInteger(c.start) || !Number.isInteger(c.duration) || !Number.isInteger(c.inPoint)) out.push(`${where}: not on whole frames (in ${c.inPoint})`)
    if (c.start < 0) out.push(`${where}: starts before 0`)
    if (c.duration < 1) out.push(`${where}: has no length`)
    if (c.inPoint < 0) out.push(`${where}: starts before its footage does (${c.inPoint})`)
    if (c.assetId && !p.assets[c.assetId]) out.push(`${where}: plays media that isn't in the project`)
    const src = sourceFrames(p, c)
    // At normal speed a clip's footage is counted in whole frames, and none may be missing. A re-timed clip isn't
    // checked: it is cut on whole timeline frames, which are fractions of its footage, and a ramp cut in two bends
    // a little differently between its keyframes (or loses them, and plays on at its base speed) — the player
    // holds the last frame. Nor is a clip that plays a nested timeline: that timeline can get shorter under it.
    const exact = c.speed === 1 && !c.keyframes.speed?.length && !c.sequenceId && !c.freeze
    if (src !== Infinity && exact && c.inPoint + consumed(c) > src + 1) out.push(`${where}: runs ${c.inPoint + consumed(c) - src} frames past the end of its footage (speed ${c.speed})`)
    if (!(c.speed > 0) || !Number.isFinite(c.speed)) out.push(`${where}: speed ${c.speed}`)
    if (c.audio.fadeIn < 0 || c.audio.fadeOut < 0) out.push(`${where}: a negative fade`)
    // (A speed ramp keeps its shape when the clip is trimmed, so its keyframes may lie past the end.)
    for (const [prop, kfs] of Object.entries(c.keyframes)) if (prop !== 'speed') for (const k of kfs ?? []) if (k.frame < 0 || k.frame > c.duration) out.push(`${where}: a ${prop} keyframe outside the clip (${k.frame})`)
    if (c.takes) {
      if (c.takes.length < 2) out.push(`${where}: a list of takes with ${c.takes.length} in it`)
      if (!c.takes.some((t) => t.id === c.takeId)) out.push(`${where}: shows a take that isn't in its list`)
      if (new Set(c.takes.map((t) => t.id)).size !== c.takes.length) out.push(`${where}: two takes with one id`)
      for (const t of c.takes) if (t.assetId && !p.assets[t.assetId]) out.push(`${where}: a take of media that isn't in the project`)
    } else if (c.takeId || c.takeSlot !== undefined) out.push(`${where}: take leftovers on a clip without takes`)
    if (c.takeSlot !== undefined && c.takeSlot <= c.duration) out.push(`${where}: remembers a place (${c.takeSlot}) no longer than it is`)
    if (c.tasks) for (const t of c.tasks) if (!t.id || typeof t.text !== 'string') out.push(`${where}: a task without an id or text`)
  }
  for (const t of p.tracks) {
    const clips = clipsOnTrack(p, t.id)
    for (let i = 1; i < clips.length; i++) if (clips[i].start < clipEnd(clips[i - 1])) out.push(`${t.name}: ${clips[i - 1].name} (${clips[i - 1].start}–${clipEnd(clips[i - 1])}) and ${clips[i].name} (from ${clips[i].start}) overlap`)
    if (isMagnetic(t)) {
      let cursor = 0
      for (const c of clips) {
        if (c.start !== cursor) out.push(`${t.name}: not edge to edge at ${cursor} (next clip starts ${c.start})`)
        cursor = clipEnd(c)
      }
    }
    if (isMagnetic(t) && t.rippleLock) out.push(`${t.name}: the main track is ripple-locked`)
  }
  for (let i = 0; i < p.markers.length; i++) {
    const m = p.markers[i]
    if (!Number.isInteger(m.frame) || m.frame < 0) out.push(`marker ${m.label}: at ${m.frame}`)
    if (i && p.markers[i - 1].frame > m.frame) out.push(`markers out of order at ${m.frame}`)
  }
  if (p.range && p.range.out <= p.range.in) out.push(`marked stretch ${p.range.in}–${p.range.out}`)
  return out
}
