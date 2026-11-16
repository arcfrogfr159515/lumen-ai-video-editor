import { describe, expect, it } from 'vitest'
import type { Asset } from '@/editor/types'
import { mediaCounts, visibleMedia, type MediaView } from './library'

function file(partial: Partial<Asset> & Pick<Asset, 'id' | 'name'>): Asset {
  return {
    kind: 'video',
    source: { type: 'file', url: 'u', mime: 'video/mp4', fileName: `${partial.name}.mp4`, size: 1 },
    addedAt: 0,
    ...partial,
    source: partial.source ?? { type: 'file', url: 'u', mime: 'video/mp4', fileName: `${partial.name}.mp4`, size: 1 },
  }
}

const view = (over: Partial<MediaView> = {}): MediaView => ({ kind: 'all', shelf: 'library', sort: 'newest', query: '', ...over })

describe('the media library list', () => {
  const assets = [
    file({ id: 'a', name: 'clip 10', addedAt: 1, duration: 4, tags: ['interview'] }),
    file({ id: 'b', name: 'clip 2', addedAt: 3, duration: 20, kind: 'audio', favorite: true }),
    file({ id: 'c', name: 'Still', addedAt: 2, kind: 'image', source: { type: 'file', url: 'u', mime: 'image/png', fileName: 'still.PNG', size: 1, missing: true } }),
    file({ id: 'm', name: 'Matte', addedAt: 9, matteOf: { assetId: 'a', subject: 'person', from: 0, to: 1 } }),
  ]

  it('finds a card by its name, a tag, or the file name, ignoring case', () => {
    expect(visibleMedia(assets, new Set(), view({ query: '  CLIP 2 ' })).map((a) => a.id)).toEqual(['b'])
    expect(visibleMedia(assets, new Set(), view({ query: 'Interview' })).map((a) => a.id)).toEqual(['a'])
    expect(visibleMedia(assets, new Set(), view({ query: 'still.png' })).map((a) => a.id)).toEqual(['c'])
  })

  it('keeps subject mattes out of the library, and narrows by kind and shelf together', () => {
    const used = new Set(['a'])
    expect(visibleMedia(assets, used, view()).map((a) => a.id)).toEqual(['b', 'c', 'a'])
    expect(visibleMedia(assets, used, view({ kind: 'audio' })).map((a) => a.id)).toEqual(['b'])
    expect(visibleMedia(assets, used, view({ shelf: 'unused' })).map((a) => a.id)).toEqual(['b', 'c'])
    expect(visibleMedia(assets, used, view({ shelf: 'offline' })).map((a) => a.id)).toEqual(['c'])
    expect(visibleMedia(assets, used, view({ shelf: 'favorites', kind: 'video' })).map((a) => a.id)).toEqual([])
    expect(visibleMedia(assets, used, view({ shelf: 'favorites' })).map((a) => a.id)).toEqual(['b'])
    expect(mediaCounts(assets, used)).toEqual({ all: 3, video: 1, image: 1, audio: 1, unused: 2, offline: 1, favorites: 1 })
    // The Audio chip stays a count of every audio card; Unused then counts unused audio only.
    expect(mediaCounts(assets, used, 'audio')).toMatchObject({ all: 3, audio: 1, unused: 1, offline: 0, favorites: 1 })
  })

  it('sorts newest first, by name with numbers in order, and longest first with stills after', () => {
    expect(visibleMedia(assets, new Set(), view({ sort: 'name' })).map((a) => a.name)).toEqual(['clip 2', 'clip 10', 'Still'])
    expect(visibleMedia(assets, new Set(), view({ sort: 'longest' })).map((a) => a.id)).toEqual(['b', 'a', 'c'])
    expect(visibleMedia(assets, new Set(), view({ sort: 'newest' })).map((a) => a.id)).toEqual(['b', 'c', 'a'])
  })
})
