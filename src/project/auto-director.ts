/**
 * The auto-director, wired to the editor: reads a multicam timeline's cameras
 * (their sound from the waveforms already measured, their picture by watching
 * the footage when asked), plans the cuts, and makes them on the multicam
 * clips as one undo step.
 */
import { angleLevels, directCuts, planSummary, switchesFor, type DirectorCut, type DirectorOptions, type PlannedSwitch } from '@/editor/auto-director'
import { clipEnd } from '@/editor/ops'
import { angleTracks } from '@/editor/sequences'
import { dispatch, getProject, useEditor } from '@/editor/store'
import type { Clip, Project, Sequence } from '@/editor/types'
import { scanFrames, toGray } from '@/engine/analysis'
import { tt } from '@/lib/i18n'

/** Seconds each value of a camera's signal covers. */
export const DIRECTOR_STEP = 0.1

export type AutoDirectOptions = Omit<DirectorOptions, 'step'>

export interface AutoDirectPlan {
  sequenceId: string
  /** The multicam clips it applies to, in timeline order. */
  clipIds: string[]
  /** The camera names, in angle order. */
  angles: string[]
  /** The whole plan, in seconds of the multicam timeline. */
  cuts: DirectorCut[]
  /** The cuts each clip gets, in timeline frames. */
  switches: Record<string, PlannedSwitch[]>
  /** Cameras with no sound of their own to go by (their indexes). */
  silent: number[]
  /** Whether the picture was watched. */
  watched: boolean
  /** How long the multicam timeline runs, in seconds. */
  seconds: number
  summary: ReturnType<typeof planSummary>
}

/** The multicam clips among `ids` that play the same multicam timeline as the first of them. */
export function multicamTargets(project: Project, ids: readonly string[]): { clips: Clip[]; seq: Sequence } | null {
  const clips = ids.map((id) => project.clips[id]).filter((c): c is Clip => Boolean(c?.sequenceId && project.sequences?.[c.sequenceId]?.multicam))
  if (!clips.length) return null
  const seq = project.sequences![clips[0].sequenceId!]
  return { clips: clips.filter((c) => c.sequenceId === seq.id).sort((a, b) => a.start - b.start), seq }
}

/**
 * How much each camera's picture moves, per step of the multicam timeline:
 * the mean change in brightness from one frame to the next, read small.
 * Decodes the footage, so it takes a while on long recordings.
 */
export async function angleMotion(project: Project, seq: Sequence, onProgress?: (p: number) => void, signal?: AbortSignal): Promise<(number[] | undefined)[]> {
  const fps = seq.settings.fps
  const end = Math.max(0, ...Object.values(seq.clips).map(clipEnd))
  const steps = Math.ceil(end / fps / DIRECTOR_STEP)
  const tracks = angleTracks(seq)
  const out: (number[] | undefined)[] = []
  for (const [index, track] of tracks.entries()) {
    const sum = new Float64Array(steps)
    const count = new Uint32Array(steps)
    let any = false
    for (const clip of Object.values(seq.clips).filter((c) => c.trackId === track.id && c.assetId)) {
      const asset = project.assets[clip.assetId!]
      if (!asset || asset.kind !== 'video' || asset.source.type !== 'file' || asset.source.missing) continue
      const from = clip.inPoint / fps
      const to = from + (clip.duration * clip.speed) / fps
      let prev: Float32Array | null = null
      let gray = new Float32Array(0)
      await scanFrames(
        asset.source.url,
        from,
        to,
        48,
        (frame) => {
          if (gray.length !== frame.rgba.length / 4) gray = new Float32Array(frame.rgba.length / 4)
          const now = toGray(frame.rgba, gray)
          if (prev) {
            let diff = 0
            for (let i = 0; i < now.length; i++) diff += Math.abs(now[i] - prev[i])
            // Where this frame is on the multicam timeline.
            const at = (clip.start + (frame.t * fps - clip.inPoint) / clip.speed) / fps
            const bin = Math.floor(at / DIRECTOR_STEP)
            if (bin >= 0 && bin < steps) {
              sum[bin] += diff / now.length
              count[bin]++
              any = true
            }
          }
          prev = Float32Array.from(now)
          onProgress?.((index + Math.min(1, (frame.t - from) / Math.max(1e-6, to - from))) / tracks.length)
        },
        signal,
      )
    }
    out.push(any ? Array.from(sum, (v, i) => (count[i] ? v / count[i] : 0)) : undefined)
    onProgress?.((index + 1) / tracks.length)
  }
  return out
}

/** Plans the cuts for some multicam clips. `motion` is what watching the picture found, when it was watched. */
export function planAutoDirect(project: Project, clipIds: readonly string[], opts: AutoDirectOptions = {}, motion?: (number[] | undefined)[]): AutoDirectPlan {
  const targets = multicamTargets(project, clipIds)
  if (!targets) throw new Error(tt('Select a multicam clip: one that plays a multicam timeline.'))
  const { clips, seq } = targets
  const tracks = angleTracks(seq)
  if (tracks.length < 2) throw new Error(tt('“{0}” has only one camera — there is nothing to cut between.', seq.name))
  const { levels, seconds, missing } = angleLevels(project, seq, DIRECTOR_STEP)
  const cuts = directCuts(
    levels.map((level, i) => ({ level, ...(motion?.[i] ? { motion: motion[i] } : {}) })),
    { ...opts, step: DIRECTOR_STEP },
  )
  const switches: Record<string, PlannedSwitch[]> = {}
  for (const c of clips) switches[c.id] = switchesFor(project, c, cuts)
  return {
    sequenceId: seq.id,
    clipIds: clips.map((c) => c.id),
    angles: tracks.map((t) => t.name),
    cuts,
    switches,
    silent: missing.filter((i) => !motion?.[i]),
    watched: Boolean(motion?.some(Boolean)),
    seconds,
    summary: planSummary(cuts, seconds, tracks.length),
  }
}

/** Makes a plan's cuts, as one undo step. Returns how many cuts were made and the pieces the clips now are. */
export function applyAutoDirect(plan: AutoDirectPlan, source: 'user' | 'ai' = 'user'): { cuts: number; clipIds: string[] } {
  let made = 0
  const pieces: string[] = []
  let failed: string | undefined
  useEditor.getState().transaction(tt('Auto-direct multicam'), source, () => {
    for (const clipId of plan.clipIds) {
      if (!getProject().clips[clipId]) continue
      // Each switch cuts the piece the one before it left behind.
      let piece = clipId
      pieces.push(piece)
      for (const s of plan.switches[clipId] ?? []) {
        const res = dispatch('multicam.switch', { frame: s.frame, angle: s.angle, clipId: piece }, { source })
        if (!res.ok) {
          failed = res.error
          continue
        }
        // A switch on the clip's first frame changes the whole piece; any other cuts it and hands back the new one.
        const next = res.result as string
        if (next !== piece) {
          made++
          pieces.push(next)
        }
        piece = next
      }
    }
  })
  if (failed && !made) throw new Error(failed)
  return { cuts: made, clipIds: pieces }
}
