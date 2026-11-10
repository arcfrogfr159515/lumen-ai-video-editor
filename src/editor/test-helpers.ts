/**
 * What the editor's tests share: a fresh project, media that needs no files,
 * and clips added through the command layer like everything else.
 */
import { createEmptyProject } from './new-project'
import { clipEnd, clipsOnTrack } from './ops'
import { dispatch, getProject, useEditor } from './store'
import type { CommandInput, CommandName } from './commands'
import type { Asset, Clip, SpeechSegment } from './types'

export const FPS = 30

export function freshProject(name = 'Test') {
  useEditor.getState().loadProject(createEmptyProject(name))
}

export function asset(id: string, seconds: number, kind: Asset['kind'] = 'video', extra: Partial<Asset> = {}): Asset {
  const ext = kind === 'audio' ? 'wav' : kind === 'image' ? 'png' : 'mp4'
  return {
    id,
    name: id,
    kind,
    ...(kind === 'image' ? {} : { duration: seconds }),
    hasAudio: kind !== 'image',
    source: { type: 'file', url: `${id}.${ext}`, mime: kind === 'audio' ? 'audio/wav' : kind === 'image' ? 'image/png' : 'video/mp4', fileName: `${id}.${ext}`, size: 1 },
    addedAt: 0,
    ...extra,
  }
}

export function addAsset(id: string, seconds: number, kind: Asset['kind'] = 'video', extra: Partial<Asset> = {}) {
  run('asset.add', { asset: asset(id, seconds, kind, extra) })
  return id
}

export const transcript = (...lines: [number, number, string][]): SpeechSegment[] => lines.map(([start, end, text]) => ({ start, end, text }))

/** Dispatches a command and returns its result; a refused command fails the test with its message. */
export function run<N extends CommandName>(name: N, input: CommandInput<N>) {
  const res = dispatch(name, input)
  if (!res.ok) throw new Error(`${name}: ${res.error}`)
  return res.result
}

/** The error a command is refused with (fails the test if it goes through). */
export function refusal<N extends CommandName>(name: N, input: CommandInput<N>) {
  const res = dispatch(name, input)
  if (res.ok) throw new Error(`${name} went through`)
  return res.error
}

export const trackId = (name: string) => {
  const t = getProject().tracks.find((t) => t.name === name)
  if (!t) throw new Error(`No track named ${name}`)
  return t.id
}

export const clip = (id: string) => getProject().clips[id]

/** [start, end) of every clip on a track, in order. */
export const spans = (track: string) => clipsOnTrack(getProject(), trackId(track)).map((c) => [c.start, clipEnd(c)])

/** The clips on a track, in order. */
export const onTrack = (track: string) => clipsOnTrack(getProject(), trackId(track))

/** Adds a clip through the command layer and returns its id. */
export function add(track: string, start: number, duration: number, extra: { assetId?: string; inPoint?: number; kind?: Clip['kind']; name?: string } = {}) {
  const kind = extra.kind ?? (getProject().tracks.find((t) => t.name === track)?.kind === 'audio' ? 'audio' : 'video')
  return run('clip.add', { trackId: trackId(track), kind, start, duration, assetId: extra.assetId, inPoint: extra.inPoint, name: extra.name }) as string
}
