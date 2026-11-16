/**
 * What the Media panel lists: kind, shelf, search and sort. Pure, so the
 * panel and the tests share one set of rules.
 */
import type { Asset, AssetKind } from '@/editor/types'

export type MediaKindFilter = 'all' | AssetKind
/** library: everything that passed the kind filter. The others narrow it. */
export type MediaShelf = 'library' | 'unused' | 'offline' | 'favorites'
export type MediaSort = 'newest' | 'name' | 'longest'

export interface MediaView {
  kind: MediaKindFilter
  shelf: MediaShelf
  sort: MediaSort
  query: string
}

const byName = (a: Asset, b: Asset) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }) || a.id.localeCompare(b.id)

/** Name, tags and the file name on disk, so a renamed card is still found by its file. */
export function mediaHaystack(asset: Asset): string {
  const file = asset.source.type === 'file' ? asset.source.fileName : asset.source.pattern
  return `${asset.name} ${asset.tags?.join(' ') ?? ''} ${file}`.toLowerCase()
}

export function sortMedia(assets: readonly Asset[], sort: MediaSort): Asset[] {
  return [...assets].sort((a, b) => {
    if (sort === 'name') return byName(a, b)
    if (sort === 'longest') {
      // Stills have no duration; they follow every timed item.
      if (a.duration == null && b.duration == null) return byName(a, b)
      if (a.duration == null) return 1
      if (b.duration == null) return -1
      return b.duration - a.duration || byName(a, b)
    }
    return b.addedAt - a.addedAt || byName(a, b)
  })
}

export function visibleMedia(assets: readonly Asset[], used: ReadonlySet<string>, view: MediaView): Asset[] {
  const q = view.query.trim().toLowerCase()
  const list = assets.filter((a) => {
    if (a.matteOf) return false
    if (view.kind !== 'all' && a.kind !== view.kind) return false
    if (view.shelf === 'unused' && used.has(a.id)) return false
    if (view.shelf === 'offline' && !a.source.missing) return false
    if (view.shelf === 'favorites' && !a.favorite) return false
    return !q || mediaHaystack(a).includes(q)
  })
  return sortMedia(list, view.sort)
}

/**
 * Kind chips count the whole library. Shelf chips count only the current kind,
 * so the number on Unused matches the cards that shelf will show.
 */
export function mediaCounts(assets: readonly Asset[], used: ReadonlySet<string>, kind: MediaKindFilter = 'all') {
  const c = { all: 0, video: 0, image: 0, audio: 0, unused: 0, offline: 0, favorites: 0 }
  for (const a of assets) {
    if (a.matteOf) continue
    c.all++
    c[a.kind]++
    if (kind !== 'all' && a.kind !== kind) continue
    if (!used.has(a.id)) c.unused++
    if (a.source.missing) c.offline++
    if (a.favorite) c.favorites++
  }
  return c
}
