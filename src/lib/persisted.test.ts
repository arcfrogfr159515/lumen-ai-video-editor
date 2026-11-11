import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { between, choice, each, flag, kept } from './persisted'

const told = vi.hoisted(() => [] as string[])
vi.mock('sonner', () => ({ toast: Object.assign(() => {}, { warning: (title: string) => void told.push(title), error: () => {}, success: () => {} }) }))

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
  let full = false
  const storage = {
    getItem: (k: string) => stored.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (full) throw Object.assign(new Error(`Failed to execute 'setItem' on 'Storage': Setting the value of '${k}' exceeded the quota.`), { name: 'QuotaExceededError' })
      stored.set(k, v)
    },
    removeItem: (k: string) => void stored.delete(k),
  }
  /** The editor starting with whatever is in local storage. */
  const start = async () => {
    vi.resetModules()
    // The store looks for it where a browser has it.
    vi.stubGlobal('window', { localStorage: storage })
    const { useUI } = await import('@/editor/ui-store')
    return { ui: useUI.getState(), useUI }
  }
  const put = (key: string, state: unknown, version = 0) => stored.set(key, JSON.stringify({ state, version }))

  beforeEach(() => {
    stored.clear()
    full = false
    told.length = 0
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => vi.unstubAllGlobals())

  it('come back as they were left', async () => {
    put('lumen.ui.v1', { leftTab: 'looks', rightTab: 'mixer', snapping: false, pxPerSecond: 120, playbackRes: 0.5, pausedRes: 0.25, renderRes: 1, upscale: 'smooth', angleViewer: false })
    const { ui } = await start()
    expect(ui).toMatchObject({ leftTab: 'looks', rightTab: 'mixer', snapping: false, pxPerSecond: 120, playbackRes: 0.5, pausedRes: 0.25, renderRes: 1, upscale: 'smooth', angleViewer: false, useProxies: true })
  })

  it('start with their defaults where what was stored is of the wrong kind', async () => {
    // A tab a newer Lumen has, a zoom no timeline can show, words where there were switches.
    put('lumen.ui.v1', { leftTab: 'colour-wheels', rightTab: null, snapping: 'yes', pxPerSecond: 1e9, playbackRes: 'best', pausedRes: 'auto', renderRes: 2, upscale: 7, usePreviews: 0, selection: 'poison', setZoom: 'not a function' })
    const { ui } = await start()
    expect(ui).toMatchObject({ leftTab: 'media', rightTab: 'inspector', snapping: true, pxPerSecond: 720, playbackRes: 'auto', pausedRes: 1, renderRes: 0.5, upscale: 'sharp', usePreviews: true, selection: [] })
    // What the panels do with these on every start: none of it may throw.
    expect(typeof ui.setZoom).toBe('function')
    expect(ui.selection.includes('x')).toBe(false)
  })

  it('start with their defaults when what was stored can’t be read at all', async () => {
    stored.set('lumen.ui.v1', '{"state":{"leftTab":"no')
    expect((await start()).ui.leftTab).toBe('media')
    stored.set('lumen.ui.v1', 'null')
    expect((await start()).ui.leftTab).toBe('media')
  })

  it('change without an error when storage is full, and say once that they weren’t kept', async () => {
    const { useUI } = await start()
    full = true
    // Every one of these writes the store: none may throw, and each still takes effect.
    useUI.getState().setLeftTab('audio')
    useUI.getState().setZoom(90)
    useUI.getState().toggleSnapping()
    expect(useUI.getState()).toMatchObject({ leftTab: 'audio', pxPerSecond: 90, snapping: false })
    expect(told).toEqual(['Your settings couldn’t be saved'])
    expect(stored.size).toBe(0)
    // Room again: the next change is written, and a later failure would be said again.
    full = false
    useUI.getState().setLeftTab('text')
    expect(JSON.parse(stored.get('lumen.ui.v1')!).state).toMatchObject({ leftTab: 'text', pxPerSecond: 90, snapping: false })
    full = true
    useUI.getState().setLeftTab('looks')
    expect(told).toEqual(['Your settings couldn’t be saved', 'Your settings couldn’t be saved'])
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
