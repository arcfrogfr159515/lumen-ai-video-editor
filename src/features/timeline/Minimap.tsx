/**
 * The overview strip: the whole timeline at a glance above the ruler — every
 * clip as a bar in its colour, pictures along the main track, markers and the
 * marked stretch — with the part on screen as a window. Drag the window to
 * scroll, its edges to zoom, click anywhere to go there.
 */
import { useEffect, useMemo, useRef, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import { clipTint } from '@/editor/clip-colors'
import { filterMarkers } from '@/editor/markers'
import { projectDuration } from '@/editor/ops'
import { overviewRows, overviewSeconds, overviewWindow, scrollForWindow, scrollToCentre, zoomForWindow } from '@/editor/overview'
import { onPlayhead, playback } from '@/editor/playback'
import { useEditor } from '@/editor/store'
import { useTimelineView } from '@/editor/timeline-view'
import { useUI, ZOOM_MAX, ZOOM_MIN } from '@/editor/ui-store'
import { assetThumb } from '@/features/assets/shared'
import { actions } from '@/features/shell/actions'
import { useElementSize } from '@/lib/hooks'
import { clamp } from '@/lib/math'
import { CLIP_COLOR, HEADER_W } from './model'
import { MARKER_COLORS } from './Ruler'
import { cssColor } from './strips'
import { anchorNextZoom, useViewport } from './viewport'

export const MINIMAP_H = 40
const PAD = 4

/** Posters, decoded once and kept: the strip redraws often and must not wait on them. */
const posters = new Map<string, HTMLImageElement | 'loading' | 'error'>()

function poster(url: string, ready: () => void): HTMLImageElement | null {
  const hit = posters.get(url)
  if (hit instanceof HTMLImageElement) return hit
  if (hit) return null
  posters.set(url, 'loading')
  const img = new Image()
  img.onload = () => {
    posters.set(url, img)
    ready()
  }
  img.onerror = () => posters.set(url, 'error')
  img.src = url
  return null
}

export function Minimap({ scrollRef }: { scrollRef: RefObject<HTMLDivElement | null> }) {
  const project = useEditor((s) => s.project)
  const pps = useUI((s) => s.pxPerSecond)
  const scrollLeft = useViewport((s) => s.scrollLeft)
  const viewW = useViewport((s) => s.width)
  const markerKinds = useTimelineView((s) => s.markerKinds)
  const hideDone = useTimelineView((s) => s.hideDone)
  const stripRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const playheadRef = useRef<HTMLDivElement>(null)
  const { width } = useElementSize(stripRef)
  const fps = project.settings.fps
  const total = overviewSeconds(projectDuration(project), fps)
  const win = overviewWindow(scrollLeft, viewW, pps, total)
  const markers = useMemo(() => filterMarkers(project.markers, { kinds: markerKinds, hideDone }), [project.markers, markerKinds, hideDone])

  // Redraws when the timeline changes or a poster arrives — not when it scrolls: the window is its own element.
  const redraw = useRef(0)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || width <= 0) return
    const paint = () => {
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(MINIMAP_H * dpr)
      const ctx = canvas.getContext('2d')!
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, width, MINIMAP_H)
      const x = (frame: number) => (frame / fps / total) * width
      const rows = new Map(overviewRows(project.tracks, MINIMAP_H - PAD * 2).map((r) => [r.trackId, r]))

      if (project.range) {
        ctx.fillStyle = 'rgba(214,238,0,0.10)'
        ctx.fillRect(x(project.range.in), 0, Math.max(1, x(project.range.out) - x(project.range.in)), MINIMAP_H)
      }
      for (const clip of Object.values(project.clips)) {
        const row = rows.get(clip.trackId)
        if (!row) continue
        const track = project.tracks.find((t) => t.id === clip.trackId)
        const left = x(clip.start)
        const w = Math.max(1, x(clip.start + clip.duration) - left - 0.5)
        const top = PAD + row.top
        ctx.globalAlpha = track?.hidden || track?.muted ? 0.35 : 1
        ctx.fillStyle = cssColor(clipTint(project, clip)?.css ?? (clip.sequenceId ? 'var(--color-clip-nest)' : CLIP_COLOR[clip.kind]))
        ctx.fillRect(left, top, w, row.height)
        // Pictures along the main track: each clip's poster, where there is room for one.
        const asset = clip.assetId ? project.assets[clip.assetId] : undefined
        const thumb = track?.role === 'main' && asset && asset.kind !== 'audio' && row.height >= 8 ? assetThumb(asset) : undefined
        if (thumb && w >= row.height * 1.2) {
          const img = poster(thumb, () => (redraw.current = requestAnimationFrame(paint)))
          if (img) {
            const pw = Math.min(w, (img.naturalWidth / img.naturalHeight) * row.height)
            ctx.save()
            ctx.beginPath()
            ctx.rect(left, top + 1.5, w, row.height - 1.5)
            ctx.clip()
            for (let px = left; px < left + w; px += pw + 1) ctx.drawImage(img, px, top + 1.5, pw, row.height - 1.5)
            ctx.restore()
          }
        }
      }
      ctx.globalAlpha = 1
      for (const m of markers) {
        ctx.fillStyle = MARKER_COLORS[m.color]
        ctx.globalAlpha = m.kind === 'todo' && m.done ? 0.4 : 1
        const mx = Math.round(x(m.frame))
        ctx.fillRect(mx, 0, m.kind === 'chapter' ? 2 : 1, m.kind === 'chapter' ? MINIMAP_H : 6)
      }
      ctx.globalAlpha = 1
    }
    paint()
    return () => cancelAnimationFrame(redraw.current)
  }, [project, markers, width, fps, total])

  useEffect(
    () =>
      onPlayhead((f) => {
        if (playheadRef.current) playheadRef.current.style.transform = `translateX(${(f / fps / total) * width}px)`
      }),
    [fps, total, width],
  )

  const fractionAt = (clientX: number) => {
    const r = stripRef.current!.getBoundingClientRect()
    return clamp((clientX - r.left) / r.width, 0, 1)
  }
  const scrollTo = (left: number) => {
    const el = scrollRef.current
    if (el) el.scrollLeft = left
  }

  /** Drag the window to scroll; a click outside it brings the view there first. */
  const pan = (e: ReactPointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    const at = fractionAt(e.clientX)
    const inside = at >= win.x0 && at <= win.x1
    const grab = inside ? at - win.x0 : (win.x1 - win.x0) / 2
    if (!inside) scrollTo(scrollToCentre(at, viewW, pps, total))
    // Alt scrubs the playhead instead of scrolling.
    if (e.altKey) playback.seek(Math.round(at * total * fps))
    const move = (ev: PointerEvent) => {
      const f = fractionAt(ev.clientX)
      if (ev.altKey) playback.seek(Math.round(f * total * fps))
      else scrollTo(scrollForWindow(f - grab, pps, total))
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.style.cursor = ''
    }
    document.body.style.cursor = 'grabbing'
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  /** Drag an edge of the window to zoom: the view comes to show exactly what the window covers. */
  const resize = (e: ReactPointerEvent, edge: 'start' | 'end') => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const fixed = edge === 'start' ? win.x1 : win.x0
    const move = (ev: PointerEvent) => {
      const f = fractionAt(ev.clientX)
      const [a, b] = edge === 'start' ? [Math.min(f, fixed - 0.004), fixed] : [fixed, Math.max(f, fixed + 0.004)]
      const next = zoomForWindow(a, b, viewW, total, [ZOOM_MIN, ZOOM_MAX], edge === 'start' ? 'end' : 'start')
      if (next.pps === useUI.getState().pxPerSecond) return scrollTo(next.scrollLeft)
      anchorNextZoom(next.scrollLeft / next.pps, 0)
      useUI.getState().setZoom(next.pps)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.style.cursor = ''
    }
    document.body.style.cursor = 'ew-resize'
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const left = win.x0 * width
  const w = Math.max(6, (win.x1 - win.x0) * width)

  return (
    <div data-minimap className="flex shrink-0 border-b border-line bg-black/20" style={{ height: MINIMAP_H }}>
      <div className="flex shrink-0 items-center border-r border-line px-3 text-2xs font-medium text-fg-4" style={{ width: HEADER_W }}>
        Overview
      </div>
      <div
        ref={stripRef}
        className="relative min-w-0 flex-1 cursor-pointer touch-none overflow-hidden"
        onPointerDown={pan}
        onDoubleClick={actions.zoomToFit}
        title="The whole timeline. Drag the window to scroll, its edges to zoom · click to go there · Alt-drag to scrub · double-click to fit"
      >
        <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 block h-full w-full" />
        <div
          data-minimap-window
          className="absolute inset-y-0 cursor-grab rounded-[4px] bg-white/[0.07] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.5),0_0_0_100vmax_rgb(0_0_0/0.38)] active:cursor-grabbing"
          style={{ left, width: w }}
        >
          <span onPointerDown={(e) => resize(e, 'start')} className="absolute inset-y-0 -left-1 w-2.5 cursor-ew-resize" aria-label="Drag to zoom from the left" />
          <span onPointerDown={(e) => resize(e, 'end')} className="absolute inset-y-0 -right-1 w-2.5 cursor-ew-resize" aria-label="Drag to zoom from the right" />
        </div>
        <div ref={playheadRef} data-minimap-playhead className="pointer-events-none absolute inset-y-0 left-0 -ml-px w-[2px] bg-white shadow-[0_0_6px_rgb(255_255_255/0.6)] will-change-transform" />
      </div>
    </div>
  )
}
