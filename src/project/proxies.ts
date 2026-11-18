/**
 * Proxies: small, quick-to-seek H.264 copies of heavy footage (4K, long GOPs,
 * HEVC…) that the preview plays instead of the original. Exports, stills and
 * the AI always read the original. Made in the background, one at a time, with
 * WebCodecs, and streamed to Lumen's media folder.
 */
import { ALL_FORMATS, Conversion, Input, Mp4OutputFormat, Output, QUALITY_MEDIUM, StreamTarget, UrlSource, type StreamTargetChunk } from 'mediabunny'
import { toast } from 'sonner'
import { create } from 'zustand'
import { dispatch, getProject } from '@/editor/store'
import type { Asset, Project } from '@/editor/types'
import { useUI } from '@/editor/ui-store'
import { desktop } from '@/lib/platform'
import { tt } from '@/lib/i18n'

/** Proxies being made: asset id → progress (0..1). */
export const useProxyJobs = create<{ jobs: Record<string, number> }>(() => ({ jobs: {} }))

const PROXY_HEIGHT = 540

/** Footage heavy enough that the preview is better off with a proxy. */
export const wantsProxy = (a: Asset) => a.kind === 'video' && a.source.type === 'file' && !a.source.missing && Math.max(a.width ?? 0, a.height ?? 0) >= 2560

export const canProxy = (a: Asset) => Boolean(desktop) && a.kind === 'video' && a.source.type === 'file' && !a.source.missing

const queue: string[] = []
const cancels = new Map<string, () => void>()
/** Assets whose proxy failed this session, so they aren't retried in a loop. */
const failed = new Set<string>()
let running = false

const setProgress = (assetId: string, p: number | null) =>
  useProxyJobs.setState((s) => {
    const jobs = { ...s.jobs }
    if (p === null) delete jobs[assetId]
    else jobs[assetId] = p
    return { jobs }
  })

export function makeProxy(assetId: string) {
  if (!desktop || queue.includes(assetId) || cancels.has(assetId)) return
  failed.delete(assetId)
  queue.push(assetId)
  setProgress(assetId, 0)
  void pump()
}

export function cancelProxy(assetId: string) {
  const i = queue.indexOf(assetId)
  if (i >= 0) {
    queue.splice(i, 1)
    setProgress(assetId, null)
  }
  cancels.get(assetId)?.()
}

export function removeProxy(assetId: string) {
  if (getProject().assets[assetId]?.proxy) dispatch('asset.update', { id: assetId, patch: { proxy: null } })
}

/** Queues proxies for heavy footage that lacks one (when the preference is on). */
export function ensureProxies(project: Project) {
  if (!desktop || !useUI.getState().autoProxies) return
  for (const a of Object.values(project.assets)) if (wantsProxy(a) && !a.proxy && !failed.has(a.id)) makeProxy(a.id)
}

async function pump() {
  if (running) return
  running = true
  try {
    while (queue.length) {
      const assetId = queue.shift()!
      // Being made from here on — not only once its conversion exists. Between the two (the file's header is being
      // read) it was neither queued nor cancellable: asked for again, it was made a second time, over the file the
      // preview was playing; cancelled, it was made all the same. The media list changing asks again by itself.
      let stopped = false
      let outdated = false
      cancels.set(assetId, () => void (stopped = true))
      try {
        outdated = (await build(assetId, () => stopped)) === 'outdated'
      } catch (err) {
        failed.add(assetId)
        if (!(err instanceof Error && err.name === 'ConversionCanceledError'))
          toast.error(tt('Couldn’t make a proxy'), { description: `${getProject().assets[assetId]?.name ?? tt('Video')}: ${err instanceof Error ? err.message : String(err)}` })
      } finally {
        cancels.delete(assetId)
        setProgress(assetId, null)
      }
      // The next one comes from the file the media plays now, as it does when a proxy is let go of.
      if (outdated) ensureProxies(getProject())
    }
  } finally {
    running = false
  }
}

/** What a conversion that was cancelled throws: said the same way for one stopped before it began. */
const cancelled = () => Object.assign(new Error('The proxy was cancelled.'), { name: 'ConversionCanceledError' })

/** Whether two states of a media item play the same file, wherever it is: its size and date say so (what relinking goes by). */
const sameFile = (a: Asset, b: Asset) => a.source.type === 'file' && b.source.type === 'file' && a.source.size === b.source.size && a.source.mtime === b.source.mtime

/** Makes one proxy and gives it to its media. 'outdated' when the media plays another file by the time it is made: it is not given. */
async function build(assetId: string, stopped: () => boolean): Promise<'outdated' | void> {
  const asset = getProject().assets[assetId]
  if (!asset || asset.source.type !== 'file' || !desktop) return
  const api = desktop
  const input = new Input({ source: new UrlSource(asset.source.url), formats: ALL_FORMATS })
  try {
    const track = await input.getPrimaryVideoTrack()
    if (!track) throw new Error(tt('It has no video to make a proxy of.'))
    if (stopped()) throw cancelled()
    const height = Math.min(PROXY_HEIGHT, track.displayHeight) & ~1
    const width = Math.round((track.displayWidth * height) / track.displayHeight / 2) * 2
    // The file name carries the source's modification time, so a replaced file gets a fresh proxy.
    const handle = await api.files.beginProxy(`${assetId}-${asset.source.mtime ?? 0}`)
    const writable = new WritableStream<StreamTargetChunk>({ write: (chunk) => api.export.write(handle.id, chunk.position, chunk.data.slice()) })
    const output = new Output({ format: new Mp4OutputFormat({ fastStart: false }), target: new StreamTarget(writable, { chunked: true, chunkSize: 4 * 1024 * 1024 }) })
    try {
      const conversion = await Conversion.init({
        input,
        output,
        tracks: 'primary',
        // A key frame every second keeps scrubbing snappy.
        video: { width, height, fit: 'contain', codec: 'avc', bitrate: QUALITY_MEDIUM, keyFrameInterval: 1, forceTranscode: true },
        audio: { discard: true },
        showWarnings: false,
      })
      if (!conversion.isValid) throw new Error(tt('This video can’t be converted here.'))
      conversion.onProgress = (p) => setProgress(assetId, p)
      cancels.set(assetId, () => void conversion.cancel())
      if (stopped()) throw cancelled()
      await conversion.execute()
      const done = await api.export.finish(handle.id)
      const info = await api.files.urlForPath(done.path)
      if (!info) throw new Error(tt('The proxy file went missing.'))
      const now = getProject().assets[assetId]
      if (!now) return
      // Making it took a while, and the media may play another file by now (relinked, a constant-frame-rate copy
      // made of it or taken back): this is a copy of the file it had, and the preview would show that one's pictures.
      if (!sameFile(now, asset)) return 'outdated'
      dispatch('asset.update', { id: assetId, patch: { proxy: { path: done.path, url: info.url, width, height } } }, { history: false })
    } catch (err) {
      await api.export.abort(handle.id).catch(() => {})
      throw err
    }
  } finally {
    input.dispose()
  }
}
