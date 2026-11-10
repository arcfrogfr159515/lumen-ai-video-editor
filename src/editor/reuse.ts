/**
 * Footage used more than once: the stretches of a media item that play in two
 * or more places on the timeline. A shot that comes round twice is sometimes
 * the point and often an accident; this finds every one so each can be judged.
 */
import { consumed, localForSource } from './timing'
import type { Clip, Frame, Project } from './types'

export interface ReuseSpan {
  assetId: string
  /** What repeats: the picture, or the sound of a clip on an audio track. */
  stream: 'picture' | 'sound'
  /** The repeated stretch of the source, in project frames. */
  from: number
  to: number
  /** Every clip that plays it, and where in the clip (clip frames, [start, end)). */
  uses: { clipId: string; start: Frame; end: Frame }[]
}

/** Clips whose source footage this looks at: media playing at some speed (not stills, titles or freeze frames). */
const plays = (c: Clip) => Boolean(c.assetId) && !c.sequenceId && !c.freeze && (c.kind === 'video' || c.kind === 'audio')

/**
 * Every stretch of source that plays in two or more clips. Picture (video
 * clips) and sound (clips on audio tracks) are looked at separately, so a video
 * and its own detached sound are one use, not two. `minFrames` leaves out
 * overlaps too short to notice.
 */
export function findReuse(project: Pick<Project, 'clips' | 'assets'>, minFrames = 2): ReuseSpan[] {
  const byStream = new Map<string, Clip[]>()
  for (const c of Object.values(project.clips)) {
    if (!plays(c) || !project.assets[c.assetId!]) continue
    const key = `${c.assetId}|${c.kind === 'audio' ? 'sound' : 'picture'}`
    byStream.set(key, [...(byStream.get(key) ?? []), c])
  }
  const out: ReuseSpan[] = []
  for (const [key, clips] of byStream) {
    if (clips.length < 2) continue
    const [assetId, stream] = key.split('|') as [string, ReuseSpan['stream']]
    // Sweep the source: at every edge, the clips still open decide whether the stretch repeats.
    const edges: { at: number; clip: Clip; open: boolean }[] = []
    for (const c of clips) {
      const used = consumed(c)
      if (used <= 0) continue
      edges.push({ at: c.inPoint, clip: c, open: true }, { at: c.inPoint + used, clip: c, open: false })
    }
    edges.sort((a, b) => a.at - b.at || Number(a.open) - Number(b.open))
    const open = new Map<string, Clip>()
    let last = 0
    let current: ReuseSpan | null = null
    const flush = () => {
      if (current && current.to - current.from >= minFrames) out.push(current)
      current = null
    }
    for (const edge of edges) {
      if (open.size >= 2 && edge.at > last) {
        const ids = [...open.keys()].sort().join(',')
        const sameAsBefore = current && current.to === last && current.uses.map((u) => u.clipId).sort().join(',') === ids
        if (sameAsBefore && current) current.to = edge.at
        else {
          flush()
          current = { assetId, stream, from: last, to: edge.at, uses: [...open.values()].map((c) => ({ clipId: c.id, start: 0, end: 0 })) }
        }
      } else if (open.size < 2) flush()
      if (edge.open) open.set(edge.clip.id, edge.clip)
      else open.delete(edge.clip.id)
      last = edge.at
    }
    flush()
  }
  for (const span of out) {
    span.uses = span.uses
      .map((u) => {
        const clip = project.clips[u.clipId]
        const a = localForSource(clip, span.from) ?? (clip.reverse ? clip.duration : 0)
        const b = localForSource(clip, span.to) ?? (clip.reverse ? 0 : clip.duration)
        return { clipId: u.clipId, start: Math.max(0, Math.floor(Math.min(a, b))), end: Math.min(clip.duration, Math.ceil(Math.max(a, b))) }
      })
      .sort((x, y) => project.clips[x.clipId].start + x.start - (project.clips[y.clipId].start + y.start))
  }
  return out.sort((a, b) => firstUse(project, a) - firstUse(project, b))
}

const firstUse = (project: Pick<Project, 'clips'>, span: ReuseSpan) => Math.min(...span.uses.map((u) => project.clips[u.clipId].start + u.start))

/** For drawing: the repeated stretches of each clip, in clip frames, merged where they touch. */
export function reuseByClip(spans: readonly ReuseSpan[]): Map<string, [Frame, Frame][]> {
  const map = new Map<string, [Frame, Frame][]>()
  for (const span of spans) for (const u of span.uses) map.set(u.clipId, [...(map.get(u.clipId) ?? []), [u.start, u.end]])
  for (const [id, ranges] of map) {
    ranges.sort((a, b) => a[0] - b[0])
    const merged: [Frame, Frame][] = []
    for (const r of ranges) {
      const prev = merged[merged.length - 1]
      if (prev && r[0] <= prev[1]) prev[1] = Math.max(prev[1], r[1])
      else merged.push([r[0], r[1]])
    }
    map.set(id, merged)
  }
  return map
}

/** How much of the timeline is footage seen before, in frames (each repeat after the first use counts). */
export function reusedFrames(spans: readonly ReuseSpan[]) {
  let total = 0
  for (const span of spans) for (const u of span.uses.slice(1)) total += u.end - u.start
  return total
}

