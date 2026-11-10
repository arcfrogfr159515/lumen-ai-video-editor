/**
 * The overview strip's arithmetic: the whole timeline squeezed into one strip,
 * the part on screen as a window on it, and what dragging that window (or its
 * edges) does to the timeline's scroll and zoom.
 */
import { clamp } from '@/lib/math'
import type { Track } from './types'

/** Seconds the strip spans: the timeline with a little room after its end, never less than `min`. */
export const overviewSeconds = (durationFrames: number, fps: number, min = 4) => Math.max(min, (durationFrames / fps) * 1.03 + 0.5)

export interface OverviewWindow {
  /** The part of the timeline on screen, as fractions of the strip (0..1). */
  x0: number
  x1: number
}

/** The part of the timeline on screen, as a window on the strip. */
export function overviewWindow(scrollLeft: number, viewWidth: number, pps: number, total: number): OverviewWindow {
  const x0 = clamp(scrollLeft / pps / total, 0, 1)
  const x1 = clamp((scrollLeft + viewWidth) / pps / total, 0, 1)
  return { x0, x1: Math.max(x1, x0) }
}

/** The scroll position that puts the window's left edge at fraction `x0` of the strip. */
export const scrollForWindow = (x0: number, pps: number, total: number) => Math.max(0, x0 * total * pps)

/** The scroll position that centres the view on fraction `x` of the strip. */
export const scrollToCentre = (x: number, viewWidth: number, pps: number, total: number) => Math.max(0, x * total * pps - viewWidth / 2)

/**
 * The zoom and scroll that make the view show exactly [x0, x1] of the strip —
 * what dragging an edge of the window asks for. The zoom stays within its limits,
 * keeping the edge that isn't being dragged where it is.
 */
export function zoomForWindow(x0: number, x1: number, viewWidth: number, total: number, limits: [number, number], anchor: 'start' | 'end' = 'start'): { pps: number; scrollLeft: number } {
  const a = clamp(Math.min(x0, x1), 0, 1)
  const b = clamp(Math.max(x0, x1), 0, 1)
  const seconds = Math.max(1e-6, (b - a) * total)
  const pps = clamp(viewWidth / seconds, limits[0], limits[1])
  const shown = viewWidth / pps
  const start = anchor === 'start' ? a * total : b * total - shown
  return { pps, scrollLeft: Math.max(0, start * pps) }
}

export interface OverviewRow {
  trackId: string
  top: number
  height: number
}

/**
 * Where each track's row sits in a strip `height` pixels tall. The main track
 * gets three rows' worth (it carries the story, and has room for pictures);
 * rows never get thinner than a hairline.
 */
export function overviewRows(tracks: readonly Pick<Track, 'id' | 'role'>[], height: number, gap = 1): OverviewRow[] {
  if (!tracks.length) return []
  const weight = (t: Pick<Track, 'role'>) => (t.role === 'main' ? 3 : 1)
  const total = tracks.reduce((n, t) => n + weight(t), 0)
  const unit = Math.max(1, (height - gap * (tracks.length - 1)) / total)
  let top = 0
  return tracks.map((t) => {
    const h = unit * weight(t)
    const row = { trackId: t.id, top, height: h }
    top += h + gap
    return row
  })
}
