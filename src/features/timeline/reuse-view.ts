/**
 * Reused footage, worked out once per state of the timeline and shared by
 * everything that shows it (the stripes on clips, the clean-up dialog).
 */
import { findReuse, reuseByClip, type ReuseSpan } from '@/editor/reuse'
import type { Clip, Frame, Project } from '@/editor/types'

interface Entry {
  assets: unknown
  spans: ReuseSpan[]
  byClip: Map<string, [Frame, Frame][]>
}

// Immer hands out a new `clips` object whenever a clip changes, so identity says whether this still holds.
const cache = new WeakMap<Record<string, Clip>, Entry>()

export function reuseOf(project: Pick<Project, 'clips' | 'assets'>): Entry {
  const hit = cache.get(project.clips)
  if (hit && hit.assets === project.assets) return hit
  const spans = findReuse(project)
  const entry = { assets: project.assets, spans, byClip: reuseByClip(spans) }
  cache.set(project.clips, entry)
  return entry
}
