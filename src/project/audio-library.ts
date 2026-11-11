/**
 * Audio the user adds without importing: Lumen's synthesized sound effects
 * and voiceovers recorded from the microphone. Both become ordinary WAV files
 * in the media library.
 */
import { toast } from 'sonner'
import type { MediaFileInfo } from '@shared/app'
import { dispatch, getProject } from '@/editor/store'
import { monitorLevel, onMonitorChange } from '@/editor/playback'
import type { Asset } from '@/editor/types'
import { computePeaks } from '@/engine/audio-engine'
import { renderSfx, SFX } from '@/engine/sfx'
import { encodeWav, resample } from '@/engine/wav'
import { uid } from '@/lib/id'
import { desktop } from '@/lib/platform'
import { tt } from '@/lib/i18n'

// ─── Sound effects ───────────────────────────────────────────────────────

const REGISTRY = 'lumen.sfx.v1'
const rendered = new Map<string, Promise<AudioBuffer>>()

function registry(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(REGISTRY) ?? '{}') as Record<string, string>
  } catch {
    return {}
  }
}

function remember(id: string, path: string) {
  try {
    localStorage.setItem(REGISTRY, JSON.stringify({ ...registry(), [id]: path }))
  } catch {
    /* storage unavailable: the file is simply re-rendered next time */
  }
}

export function sfxBuffer(id: string) {
  const def = SFX.find((s) => s.id === id)
  if (!def) return Promise.reject(new Error(tt('Unknown sound effect')))
  let p = rendered.get(id)
  if (!p) {
    p = renderSfx(def)
    rendered.set(id, p)
  }
  return p
}

async function sfxFile(id: string): Promise<MediaFileInfo> {
  if (!desktop) throw new Error(tt('Needs the desktop app.'))
  const known = registry()[id]
  if (known) {
    const info = await desktop.files.urlForPath(known)
    if (info) return info
  }
  const def = SFX.find((s) => s.id === id)!
  const info = await desktop.files.saveMedia('sfx', `${def.name}.wav`, encodeWav(await sfxBuffer(id)))
  remember(id, info.path)
  return info
}

/** The project asset for a built-in effect (created on first use). */
export async function sfxAsset(id: string): Promise<string> {
  const def = SFX.find((s) => s.id === id)
  if (!def) throw new Error(tt('Unknown sound effect'))
  const tag = `sfx:${id}`
  const existing = Object.values(getProject().assets).find((a) => a.tags?.includes(tag) && !(a.source.type === 'file' && a.source.missing))
  if (existing) return existing.id
  const file = await sfxFile(id)
  const buffer = await sfxBuffer(id)
  const asset: Asset = {
    id: uid('asset'),
    name: def.name,
    kind: 'audio',
    duration: Math.round(buffer.duration * 1000) / 1000,
    hasAudio: true,
    peaks: computePeaks(buffer),
    source: { type: 'file', url: file.url, path: file.path, mime: 'audio/wav', fileName: file.name, size: file.size, mtime: file.mtime },
    tags: [tag, 'sfx', def.category],
    addedAt: Date.now(),
  }
  const res = dispatch('asset.add', { asset }, { label: tt('Add {0}', def.name) })
  if (!res.ok) throw new Error(res.error)
  return asset.id
}

let previewCtx: AudioContext | null = null
let previewOut: GainNode | null = null
let previewNode: AudioBufferSourceNode | null = null

/** Where auditions play: the speakers, at the preview volume. */
function auditionOutput() {
  if (previewCtx && previewOut) return { ctx: previewCtx, out: previewOut }
  const ctx = (previewCtx = new AudioContext())
  const out = (previewOut = ctx.createGain())
  out.gain.value = monitorLevel()
  out.connect(ctx.destination)
  onMonitorChange((gain) => out.gain.setTargetAtTime(gain, ctx.currentTime, 0.015))
  return { ctx, out }
}

/** Plays an effect (a second call stops it). */
export async function auditionSfx(id: string, onEnd?: () => void) {
  previewNode?.stop()
  const { ctx, out } = auditionOutput()
  const buffer = await sfxBuffer(id)
  const node = ctx.createBufferSource()
  node.buffer = buffer
  node.connect(out)
  node.onended = () => {
    if (previewNode === node) previewNode = null
    onEnd?.()
  }
  previewNode = node
  node.start()
}

export function stopAudition() {
  previewNode?.stop()
  previewNode = null
}

// ─── Voiceover recording ─────────────────────────────────────────────────

export interface Recording {
  stream: MediaStream
  recorder: MediaRecorder
  analyser: AnalyserNode
  context: AudioContext
  startedAt: number
  chunks: Blob[]
}

/** Starts recording from the microphone (raw, no processing — clean-up is the editor's job). */
export async function startRecording(deviceId?: string): Promise<Recording> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { deviceId: deviceId ? { exact: deviceId } : undefined, echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
  })
  let context: AudioContext | undefined
  try {
    context = new AudioContext()
    const analyser = context.createAnalyser()
    analyser.fftSize = 1024
    context.createMediaStreamSource(stream).connect(analyser)
    const recorder = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : '', audioBitsPerSecond: 256_000 })
    const rec: Recording = { stream, recorder, analyser, context, startedAt: performance.now(), chunks: [] }
    recorder.ondataavailable = (e) => e.data.size && rec.chunks.push(e.data)
    recorder.start(250)
    return rec
  } catch (err) {
    // The microphone is on from the moment it is handed over: whatever fails after that must not leave it on.
    release(stream, context)
    throw err
  }
}

/** Lets go of the microphone and what was listening to it. */
function release(stream: MediaStream, context: AudioContext | undefined) {
  stream.getTracks().forEach((t) => t.stop())
  if (context && context.state !== 'closed') void context.close().catch(() => {})
}

/** Current input level, 0..1 (for the meter). */
export function inputLevel(rec: Recording) {
  const data = new Float32Array(rec.analyser.fftSize)
  rec.analyser.getFloatTimeDomainData(data)
  let peak = 0
  for (const v of data) peak = Math.max(peak, Math.abs(v))
  return peak
}

/** Stops, saves the take as WAV in the media library and adds it to the project. Returns the asset. */
export async function finishRecording(rec: Recording, name: string): Promise<Asset | null> {
  try {
    // A recorder that stopped by itself (the microphone was unplugged) has given all it had: there is nothing to stop.
    if (rec.recorder.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        rec.recorder.onstop = () => resolve()
        rec.recorder.onerror = () => resolve()
        rec.recorder.stop()
      })
    }
  } finally {
    release(rec.stream, rec.context)
  }
  if (!rec.chunks.length || !desktop) return null
  const decoded = await new OfflineAudioContext(1, 1, 48000).decodeAudioData(await new Blob(rec.chunks).arrayBuffer())
  if (decoded.duration < 0.3) {
    toast(tt('Recording too short'), { description: tt('Hold the record button a little longer.') })
    return null
  }
  const pcm = await resample(decoded, 48000, 1)
  const file = await desktop.files.saveMedia('recordings', `${name}.wav`, encodeWav(pcm))
  const asset: Asset = {
    id: uid('asset'),
    name,
    kind: 'audio',
    duration: Math.round(pcm.duration * 1000) / 1000,
    hasAudio: true,
    peaks: computePeaks(pcm),
    source: { type: 'file', url: file.url, path: file.path, mime: 'audio/wav', fileName: file.name, size: file.size, mtime: file.mtime },
    tags: ['recording', 'voice'],
    addedAt: Date.now(),
  }
  const res = dispatch('asset.add', { asset }, { label: tt('Record voiceover') })
  return res.ok ? asset : null
}

export function cancelRecording(rec: Recording) {
  rec.recorder.onstop = null
  try {
    if (rec.recorder.state !== 'inactive') rec.recorder.stop()
  } finally {
    release(rec.stream, rec.context)
  }
}
