import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { between, choice, each, flag, kept } from './persisted'

describe('reading stored values', () => {
  it('takes a value of the kind it should be, and nothing else', () => {
    expect([true, false, 'true', 1, null, undefined].map(flag)).toEqual([true, false, undefined, undefined, undefined, undefined])
    const tab = choice('media', 'audio', 0.5)
    expect(['media', 'audio', 0.5, 'gone', '0.5', null, {}].map(tab)).toEqual(['media', 'audio', 0.5, undefined, undefined, undefined, undefined])
    const zoom = between(6, 720)
    expect([36, 1, 100000, NaN, Infinity, '36', null].map(zoom)).toEqual([36, 6, 720, undefined, undefined, undefined, undefined])
    const kinds = each(choice('chapter', 'todo'))
    expect(kinds(['chapter', 'nope', 'todo', 7])).toEqual(['chapter', 'todo'])
    expect([kinds('chapter'), kinds(null), kinds({ 0: 'chapter' })]).toEqual([undefined, undefined, undefined])
  })

  it('merges what can be read over the defaults, and leaves the rest of the state alone', () => {
    const merge = kept<{ tab: string; open: boolean; zoom: number }>({ tab: choice('a', 'b'), open: flag, zoom: between(1, 10) })
    const defaults = { tab: 'a', open: false, zoom: 4, select: () => {}, selection: ['x'] }
    expect(merge({ tab: 'b', open: 'yes', zoom: 50, selection: 'poison', select: null, extra: 1 }, defaults)).toEqual({ ...defaults, tab: 'b', zoom: 10 })
    for (const nothing of [undefined, null, 'text', 7, []]) expect(merge(nothing, defaults)).toEqual(defaults)
  })
})

describe('the editor’s settings', () => {
  const stored = new Map<string, string>()
  const storage = { getItem: (k: string) => stored.get(k) ?? null, setItem: (k: string, v: string) => void stored.set(k, v), removeItem: (k: string) => void stored.delete(k) }
  /** The editor starting with whatever is in local storage. */
  const start = async () => {
    vi.resetModules()
    // The stores look for it where a browser has it.
    vi.stubGlobal('window', { localStorage: storage })
    const [{ useUI }, { useTimelineView }, { useMacros }] = await Promise.all([import('@/editor/ui-store'), import('@/editor/timeline-view'), import('@/editor/macro-store')])
    return { ui: useUI.getState(), view: useTimelineView.getState(), macros: useMacros.getState(), useUI, useMacros }
  }
  const put = (key: string, state: unknown, version = 0) => stored.set(key, JSON.stringify({ state, version }))

  beforeEach(() => stored.clear())
  afterEach(() => vi.unstubAllGlobals())

  it('come back as they were left', async () => {
    put('lumen.ui.v1', { leftTab: 'notes', rightTab: 'mixer', snapping: false, pxPerSecond: 120, playbackRes: 0.5, pausedRes: 0.25, renderRes: 1, upscale: 'smooth', angleViewer: false })
    put('lumen.timeline-view.v1', { storyboard: true, minimap: false, markerKinds: ['todo', 'chapter'], fourPoint: 'fit', hideDone: true })
    const macro = { id: 'macro_1', name: 'Tidy', createdAt: 1, fps: 30, steps: [{ command: 'clip.update', title: 'Edit color', input: { ids: [{ $clip: true }], patch: { color: { contrast: 20 } } } }] }
    put('lumen.macros.v1', { macros: [macro], lastId: 'macro_1' })
    const { ui, view, macros } = await start()
    expect(ui).toMatchObject({ leftTab: 'notes', rightTab: 'mixer', snapping: false, pxPerSecond: 120, playbackRes: 0.5, pausedRes: 0.25, renderRes: 1, upscale: 'smooth', angleViewer: false, useProxies: true })
    expect(view).toMatchObject({ storyboard: true, minimap: false, markerKinds: ['todo', 'chapter'], fourPoint: 'fit', hideDone: true, pauseGuides: true })
    expect(macros).toMatchObject({ macros: [macro], lastId: 'macro_1', recording: null })
  })

  it('start with their defaults where what was stored is of the wrong kind', async () => {
    // A tab a newer Lumen has, a zoom no timeline can show, words where there were switches, a list that became a word.
    put('lumen.ui.v1', { leftTab: 'colour-wheels', rightTab: null, snapping: 'yes', pxPerSecond: 1e9, playbackRes: 'best', pausedRes: 'auto', renderRes: 2, upscale: 7, usePreviews: 0, selection: 'poison', setZoom: 'not a function' })
    put('lumen.timeline-view.v1', { storyboard: 'on', markerKinds: 'todo', fourPoint: 'stretch', sourceMarks: 'poison', set: null })
    put('lumen.macros.v1', { macros: 'none', lastId: 7 })
    const { ui, view, macros } = await start()
    expect(ui).toMatchObject({ leftTab: 'media', rightTab: 'inspector', snapping: true, pxPerSecond: 720, playbackRes: 'auto', pausedRes: 1, renderRes: 0.5, upscale: 'sharp', usePreviews: true, selection: [] })
    expect(typeof ui.setZoom).toBe('function')
    expect(view).toMatchObject({ storyboard: false, markerKinds: [], fourPoint: 'source', sourceMarks: {} })
    expect(typeof view.set).toBe('function')
    // What the panels do with these on every start: none of it may throw.
    expect(view.markerKinds.includes('todo')).toBe(false)
    expect(macros.macros.map((m) => m.name)).toEqual([])
    expect(macros.lastId).toBeNull()
  })

  it('keep the macros that can be read when one of them can’t', async () => {
    const good = { id: 'macro_1', name: 'Tidy', createdAt: 1, steps: [{ command: 'clip.update', title: 'Edit color', input: {} }] }
    put('lumen.macros.v1', { macros: [good, null, { id: 'm2', name: 'No steps' }, { id: 'm3', name: 'Unknown command', steps: [{ command: 'asset.remove', title: 'x', input: {} }] }, 'text'], lastId: 'macro_1' })
    const { macros } = await start()
    expect(macros.macros).toEqual([good])
  })

  it('start with their defaults when what was stored can’t be read at all', async () => {
    stored.set('lumen.ui.v1', '{"state":{"leftTab":"no')
    stored.set('lumen.timeline-view.v1', 'null')
    stored.set('lumen.macros.v1', '[]')
    const { ui, view, macros } = await start()
    expect(ui.leftTab).toBe('media')
    expect(view.minimap).toBe(true)
    expect(macros.macros).toEqual([])
  })

  it('are still written in the form an older Lumen reads', async () => {
    const { useUI } = await start()
    useUI.getState().setLeftTab('audio')
    const written = JSON.parse(stored.get('lumen.ui.v1')!) as { state: Record<string, unknown>; version: number }
    // No version number of its own: a build that doesn't know it would throw the whole state away.
    expect(written.version).toBe(0)
    expect(written.state).toMatchObject({ leftTab: 'audio', snapping: true })
    expect(Object.keys(written.state).sort()).toEqual(['angleViewer', 'autoProxies', 'backgroundRender', 'leftTab', 'pausedRes', 'playbackRes', 'pxPerSecond', 'renderRes', 'rightTab', 'showGuides', 'snapping', 'upscale', 'usePreviews', 'useProxies'])
  })
})
