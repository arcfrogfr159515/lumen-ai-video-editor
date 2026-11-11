/**
 * Constant-frame-rate copies. Footage whose frames arrive unevenly (phones,
 * screen recorders, game capture) is re-encoded onto an even grid with
 * WebCodecs, at its own size and near-lossless quality, and the asset plays
 * the copy from then on. The original file is never touched, and the asset
 * remembers it so it can go back.
 *
 * In the desktop app the copy is streamed to Lumen's media folder. In a
 * browser tab there is nowhere to write, so the copy is kept in memory for the
 * session.
 */
import { ALL_FORMATS, BufferTarget, Conversion, getFirstEncodableVideoCodec, Input, Mp4OutputFormat, Output, QUALITY_VERY_HIGH, StreamTarget, UrlSource, type StreamTargetChunk } from 'mediabunny'
import { toast } from 'sonner'
import { create } from 'zustand'
import { constantRateFor, isUneven, needsFullCheck, rateLabel, timingFromMetrics } from '@/editor/frame-rate'
import { dispatch, getProject } from '@/editor/store'
import type { Asset, FrameTiming, OriginalMedia } from '@/editor/types'
import { desktop } from '@/lib/platform'
import { tt } from '@/lib/i18n'

/** Copies being made: asset id → progress (0..1). */
export const useConformJobs = create<{ jobs: Record<string, number> }>(() => ({ jobs: {} }))

const cancels = new Map<string, () => void>()

const setProgress = (assetId: string, p: number | null) =>
  useConformJobs.setState((s) => {
    const jobs = { ...s.jobs }
    if (p === null) delete jobs[assetId]
    else jobs[assetId] = p
    return { jobs }
  })

/** Videos read from a file that aren't a copy already. */
export const canConform = (a: Asset) => a.kind === 'video' && a.source.type === 'file' && !a.source.missing && !a.conformedFrom

/**
 * What a file's frame timestamps say, read from the file itself (null if it
 * can't be told). Every frame's timestamp is read, not only the first few
 * seconds': footage that starts evenly and stutters later is still uneven.
 */
export async function readFrameTiming(url: string): Promise<{ timing: FrameTiming | null; fps?: number; duration?: number }> {
  const input = new Input({ source: new UrlSource(url), formats: ALL_FORMATS })
  try {
    const track = await input.getPrimaryVideoTrack()
    if (!track) return { timing: null }
    const metrics = await track.computeFrameRateMetrics({ targetPacketCount: Infinity })
    return { timing: timingFromMetrics(metrics, true), fps: Math.round(metrics.bestGuessFrameRate * 1000) / 1000, duration: Math.round((await input.computeDuration()) * 1000) / 1000 }
  } finally {
    input.dispose()
  }
}

/**
 * Checks the frame timing of videos that haven't been checked (all of them, or
 * the ones given). Returns the ids of those whose frames arrive unevenly.
 */
export async function checkFrameTiming(ids?: string[], force = false): Promise<string[]> {
  // What importing found is a quick look at the start of the file: an even start is read on to the end here.
  const assets = Object.values(getProject().assets).filter((a) => a.kind === 'video' && a.source.type === 'file' && !a.source.missing && (!ids || ids.includes(a.id)) && (force || needsFullCheck(a.frameTiming)))
  for (const asset of assets) {
    if (asset.source.type !== 'file') continue
    try {
      const { timing } = await readFrameTiming(asset.source.url)
      if (timing && getProject().assets[asset.id]) dispatch('asset.update', { id: asset.id, patch: { frameTiming: timing } }, { history: false })
    } catch {
      // A file that can't be read says so elsewhere (the media panel marks it).
    }
  }
  return Object.values(getProject().assets)
    .filter((a) => (!ids || ids.includes(a.id)) && isUneven(a.frameTiming) && canConform(a))
    .map((a) => a.id)
}

/** The videos in the project whose frames arrive unevenly and that play the original file. */
export const unevenAssets = (assets: Record<string, Asset>) => Object.values(assets).filter((a) => isUneven(a.frameTiming) && canConform(a))

export function cancelConform(assetId: string) {
  cancels.get(assetId)?.()
}

/**
 * Makes a constant-frame-rate copy of an asset's video and points the asset at
 * it (one undo step). `fps` defaults to the rate that suits the footage and the
 * timeline. Resolves to true when the asset now plays the copy.
 */
export async function conformAsset(assetId: string, fps?: number): Promise<boolean> {
  const asset = getProject().assets[assetId]
  if (!asset || !canConform(asset) || asset.source.type !== 'file') return false
  if (cancels.has(assetId)) return false
  const source = asset.source
  const rate = fps ?? (asset.frameTiming ? constantRateFor(asset.frameTiming, getProject().settings.fps) : getProject().settings.fps)
  const api = desktop
  const input = new Input({ source: new UrlSource(source.url), formats: ALL_FORMATS })
  setProgress(assetId, 0)
  try {
    const track = await input.getPrimaryVideoTrack()
    if (!track) throw new Error(tt('It has no video.'))
    const handle = api ? await api.files.beginConform(`${assetId}-${source.mtime ?? 0}-${String(rate).replace('.', '_')}fps`) : null
    const memory = handle ? null : new BufferTarget()
    const target = handle
      ? new StreamTarget(new WritableStream<StreamTargetChunk>({ write: (chunk) => api!.export.write(handle.id, chunk.position, chunk.data.slice()) }), { chunked: true, chunkSize: 4 * 1024 * 1024 })
      : memory!
    const format = new Mp4OutputFormat({ fastStart: handle ? false : 'in-memory' })
    const output = new Output({ format, target })
    try {
      // H.264 where this computer can encode it at this size, else the next codec an MP4 can carry.
      const codec = await getFirstEncodableVideoCodec(format.getSupportedVideoCodecs(), { width: track.displayWidth, height: track.displayHeight })
      if (!codec) throw new Error(tt('This computer has no encoder for a video this size.'))
      const conversion = await Conversion.init({
        input,
        output,
        tracks: 'primary',
        // Every frame lands on the grid: one is repeated where the source left a hole, dropped where it bunched up.
        video: { frameRate: rate, codec, quality: QUALITY_VERY_HIGH, keyFrameInterval: 2, forceTranscode: true },
        showWarnings: false,
      })
      if (!conversion.isValid) throw new Error(tt('This video can’t be re-encoded on this computer.'))
      // The sound goes along as it is where an MP4 can hold it, re-encoded where it can't — but never left behind.
      if ((await input.getPrimaryAudioTrack()) && !conversion.utilizedTracks.some((t) => t.isAudioTrack())) throw new Error(tt('Its sound can’t be carried over into the copy on this computer.'))
      conversion.onProgress = (p) => setProgress(assetId, p)
      cancels.set(assetId, () => void conversion.cancel())
      await conversion.execute()

      let next: { url: string; path?: string; fileName: string; size: number; mtime?: number }
      if (handle && api) {
        const done = await api.export.finish(handle.id)
        const info = await api.files.urlForPath(done.path)
        if (!info) throw new Error(tt('The copy went missing.'))
        next = { url: info.url, path: info.path, fileName: info.name, size: info.size, mtime: info.mtime }
      } else {
        const bytes = memory!.buffer
        if (!bytes) throw new Error(tt('Nothing was written.'))
        next = { url: URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' })), fileName: tt('{0} ({1} fps).mp4', asset.name, rateLabel(rate)), size: bytes.byteLength }
      }
      // What the copy actually is, read back from it rather than assumed.
      const read = await readFrameTiming(next.url).catch(() => ({ timing: null, fps: undefined, duration: undefined }))
      const still = getProject().assets[assetId]
      if (!still) return false
      const original: OriginalMedia = {
        url: source.url,
        ...(source.path ? { path: source.path } : {}),
        ...(source.relPath ? { relPath: source.relPath } : {}),
        mime: source.mime,
        fileName: source.fileName,
        size: source.size,
        ...(source.mtime !== undefined ? { mtime: source.mtime } : {}),
        ...(asset.fps !== undefined ? { fps: asset.fps } : {}),
        ...(asset.duration !== undefined ? { duration: asset.duration } : {}),
        ...(asset.frameTiming ? { frameTiming: asset.frameTiming } : {}),
      }
      const res = dispatch(
        'asset.update',
        {
          id: assetId,
          patch: {
            source: { type: 'file', url: next.url, ...(next.path ? { path: next.path } : {}), mime: 'video/mp4', fileName: next.fileName, size: next.size, ...(next.mtime !== undefined ? { mtime: next.mtime } : {}), ...(source.poster ? { poster: source.poster } : {}) },
            fps: read.fps ?? rate,
            ...(read.duration ? { duration: read.duration } : {}),
            ...(read.timing ? { frameTiming: read.timing } : { frameTiming: null }),
            conformedFrom: original,
            // The proxy was made from the uneven file: the next one comes from the copy.
            ...(still.proxy ? { proxy: null } : {}),
          },
        },
        { label: tt('Constant {0} fps copy of {1}', rateLabel(rate), asset.name) },
      )
      if (!res.ok) throw new Error(res.error)
      return true
    } catch (err) {
      if (handle && api) await api.export.abort(handle.id).catch(() => {})
      throw err
    }
  } finally {
    cancels.delete(assetId)
    setProgress(assetId, null)
    input.dispose()
  }
}

/** conformAsset with the outcome shown as a toast. */
export async function conformWithToast(assetId: string, fps?: number) {
  const name = getProject().assets[assetId]?.name ?? tt('Video')
  try {
    const ok = await conformAsset(assetId, fps)
    if (ok) toast.success(tt('{0} now plays a constant-frame-rate copy', name), { description: desktop ? tt('The original file is untouched. Undo, or “Use the original”, goes back to it.') : tt('Kept in memory for this session — the desktop app keeps it on disk.') })
    return ok
  } catch (err) {
    if (err instanceof Error && err.name === 'ConversionCanceledError') toast(tt('Stopped'), { description: tt('{0} still plays the original file.', name) })
    else toast.error('Couldn’t make a constant-frame-rate copy', { description: `${name}: ${err instanceof Error ? err.message : String(err)}` })
    return false
  }
}

/** Points an asset back at the file it was imported as (false, with the reason shown, if that file is gone). */
export async function restoreOriginal(assetId: string) {
  const asset = getProject().assets[assetId]
  const from = asset?.conformedFrom
  if (!asset || !from || asset.source.type !== 'file') return false
  // A project opened again knows the original by its path: the address it is read from is asked for afresh.
  let url = from.url
  if (desktop && from.path) {
    const info = await desktop.files.urlForPath(from.path)
    if (!info) {
      toast.error('The original file isn’t where it was', { description: from.path })
      return false
    }
    url = info.url
  }
  const res = dispatch('asset.update', {
    id: assetId,
    patch: {
      source: {
        type: 'file',
        url,
        ...(from.path ? { path: from.path } : {}),
        ...(from.relPath ? { relPath: from.relPath } : {}),
        mime: from.mime,
        fileName: from.fileName,
        size: from.size,
        ...(from.mtime !== undefined ? { mtime: from.mtime } : {}),
        ...(asset.source.poster ? { poster: asset.source.poster } : {}),
      },
      ...(from.fps !== undefined ? { fps: from.fps } : {}),
      ...(from.duration !== undefined ? { duration: from.duration } : {}),
      frameTiming: from.frameTiming ?? null,
      conformedFrom: null,
      ...(asset.proxy ? { proxy: null } : {}),
    },
  })
  return res.ok
}
