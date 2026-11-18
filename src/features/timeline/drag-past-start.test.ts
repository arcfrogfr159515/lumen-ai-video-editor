import { beforeEach, describe, expect, it, vi } from 'vitest'

// No window here: the timeline's pointer gestures are driven by hand — a press on a clip, moves, a release — over
// a stand-in for the page that keeps the listeners a gesture puts on the window.
const page = vi.hoisted(() => ({ listeners: new Map<string, (e: unknown) => void>(), said: [] as string[] }))

vi.mock('sonner', () => ({
  toast: Object.assign((text: string) => void page.said.push(text), { error: (text: string) => void page.said.push(text), warning: (text: string) => void page.said.push(text), success: () => {}, loading: () => 1, dismiss: () => {}, message: () => {} }),
}))
const kept = new Map<string, string>()
vi.stubGlobal('window', {
  addEventListener: (type: string, fn: (e: unknown) => void) => void page.listeners.set(type, fn),
  removeEventListener: (type: string) => void page.listeners.delete(type),
  localStorage: { getItem: (key: string) => kept.get(key) ?? null, setItem: (key: string, value: string) => void kept.set(key, value), removeItem: (key: string) => void kept.delete(key) },
})
vi.stubGlobal('document', { body: { style: {} } })
vi.stubGlobal('requestAnimationFrame', () => 1)
vi.stubGlobal('cancelAnimationFrame', () => {})

const { usePointerController } = await import('./usePointerController')
const { computeRows } = await import('./layout')
const { getProject, useEditor } = await import('@/editor/store')
const { useUI } = await import('@/editor/ui-store')
const { add, addAsset, freshProject, spans } = await import('@/editor/test-helpers')

/** A hundred pixels a second at thirty frames a second: a frame is a third of ten pixels. */
const PPS = 100
const FPS = 30
const px = (frames: number) => (frames / FPS) * PPS

let clipId = ''

/** Presses on the clip, drags it by `frames` with the keys held, and lets go. */
function drag(frames: number, keys: { ctrlKey?: boolean; shiftKey?: boolean } = {}) {
  const tracks = getProject().tracks
  const { rowTop, rowHeight } = computeRows(tracks)
  const rect = { left: 0, top: 0, right: 4000, bottom: 2000, width: 4000, height: 2000 }
  const box = { getBoundingClientRect: () => rect, scrollLeft: 0 }
  const controller = usePointerController({
    scrollRef: { current: box } as never,
    contentRef: { current: box } as never,
    layoutRef: { current: { pps: PPS, fps: FPS, tracks, rowTop, rowHeight } } as never,
  })
  const clip = getProject().clips[clipId]
  const y = rowTop[clip.trackId] + rowHeight[clip.trackId] / 2
  const x = 1000
  const on = (selector: string) => (selector.includes('[data-clip-id]') ? { dataset: { clipId } } : null)
  const none = { ctrlKey: false, shiftKey: false, altKey: false, metaKey: false }
  controller.onPointerDown({ button: 0, clientX: x, clientY: y, ...none, target: { closest: on }, preventDefault: () => {} } as never)
  page.listeners.get('pointermove')!({ clientX: x + px(frames), clientY: y, ...none, ...keys })
  page.listeners.get('pointerup')!({ clientX: x + px(frames), clientY: y, ...none, ...keys })
}

beforeEach(() => {
  page.listeners.clear()
  page.said = []
  freshProject('Drag')
  useUI.getState().clearSelection()
  addAsset('shot', 20)
  // A free track (clips stay where they are put): a clip over frames 100–160.
  clipId = add('Overlay', 100, 60, { assetId: 'shot' })
})

describe('a clip dragged past the start of the timeline', () => {
  it('lands at the start', () => {
    drag(-180)
    expect(spans('Overlay')).toEqual([[0, 60]])
    expect(page.said).toEqual([])
  })

  it('lands at the start with Shift held (overwrite)', () => {
    // With Shift or Ctrl the clip lands exactly where it is dropped — eighty frames before the timeline begins,
    // here. The move was refused on release with what the command had to say about that number, and the clip went
    // back to where it had been.
    drag(-180, { shiftKey: true })
    expect(page.said).toEqual([])
    expect(spans('Overlay')).toEqual([[0, 60]])
  })

  it('lands at the start with Ctrl held (insert)', () => {
    drag(-180, { ctrlKey: true })
    expect(page.said).toEqual([])
    expect(spans('Overlay')).toEqual([[0, 60]])
  })

  it('is one step to undo', () => {
    drag(-180, { shiftKey: true })
    useEditor.getState().undo()
    expect(spans('Overlay')).toEqual([[100, 160]])
  })

  it('still lands where it is dropped when that is on the timeline', () => {
    drag(-40, { shiftKey: true })
    expect(spans('Overlay')).toEqual([[60, 120]])
    expect(page.said).toEqual([])
  })
})
