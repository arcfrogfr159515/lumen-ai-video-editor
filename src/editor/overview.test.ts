import { describe, expect, it } from 'vitest'
import { overviewRows, overviewSeconds, overviewWindow, scrollForWindow, scrollToCentre, zoomForWindow } from './overview'

describe('the overview strip', () => {
  it('spans the timeline with a little room after it', () => {
    expect(overviewSeconds(3000, 30)).toBeCloseTo(103.5)
    // An empty or tiny timeline still has a strip to click on.
    expect(overviewSeconds(0, 30)).toBe(4)
    expect(overviewSeconds(30, 30)).toBe(4)
  })

  it('shows the part on screen as a window, and scrolling as moving it', () => {
    // 100 s strip, 20 px a second, an 800 px view scrolled to 600 px: seconds 30 to 70.
    const win = overviewWindow(600, 800, 20, 100)
    expect(win).toEqual({ x0: 0.3, x1: 0.7 })
    expect(scrollForWindow(win.x0, 20, 100)).toBe(600)
    expect(scrollForWindow(-0.2, 20, 100)).toBe(0)
    // Clicking at 80% of the strip centres the view on second 80.
    expect(scrollToCentre(0.8, 800, 20, 100)).toBe(1200)
    // A view wider than the timeline is a window over the whole strip.
    expect(overviewWindow(0, 4000, 20, 100)).toEqual({ x0: 0, x1: 1 })
  })

  it('zooms so the view shows what the window was dragged to', () => {
    // Drag the right edge in to 50%: seconds 30 to 50 fill the 800 px view.
    const zoomed = zoomForWindow(0.3, 0.5, 800, 100, [6, 720])
    expect(zoomed).toEqual({ pps: 40, scrollLeft: 1200 })
    expect(overviewWindow(zoomed.scrollLeft, 800, zoomed.pps, 100)).toEqual({ x0: 0.3, x1: 0.5 })
    // Dragging the left edge keeps the right one where it is, even when the zoom hits its limit.
    const limited = zoomForWindow(0.699, 0.7, 800, 100, [6, 720], 'end')
    expect(limited.pps).toBe(720)
    expect(overviewWindow(limited.scrollLeft, 800, limited.pps, 100).x1).toBeCloseTo(0.7)
    // And the other way round when zooming out as far as it goes.
    const wide = zoomForWindow(0, 1, 300, 100, [6, 720])
    expect(wide).toEqual({ pps: 6, scrollLeft: 0 })
  })

  it('gives the main track three rows’ worth of the height', () => {
    const rows = overviewRows(
      [
        { id: 'titles', role: 'titles' },
        { id: 'main', role: 'main' },
        { id: 'music' },
      ],
      32,
      1,
    )
    expect(rows.map((r) => [r.trackId, r.top, r.height])).toEqual([
      ['titles', 0, 6],
      ['main', 7, 18],
      ['music', 26, 6],
    ])
    expect(overviewRows([], 32)).toEqual([])
    // Forty tracks in 32 px: hairlines, but never nothing.
    expect(overviewRows(Array.from({ length: 40 }, (_, i) => ({ id: `t${i}` })), 32).every((r) => r.height >= 1)).toBe(true)
  })
})