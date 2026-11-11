/**
 * The clip clipboard: copies of clips — and the media they use, so they paste
 * into another project too — for copy / cut / paste and paste attributes.
 * It lives for the session, across projects.
 */
import { create } from 'zustand'
import type { ClipSnapshot, EditMode } from './commands'
import { clipEnd } from './ops'
import { dispatch, getProject, rollbackTo, savepoint, useEditor } from './store'
import type { Asset, Clip, Project } from './types'
import { tt } from '@/lib/i18n'

export interface ClipboardData {
  clips: Clip[]
  assets: Asset[]
  /** Where the copied span started and ended on the timeline. */
  start: number
  end: number
}

export const useClipboard = create<{
  data: ClipboardData | null
  /** A clip whose attributes were copied on their own: paste attributes takes from it, and paste still pastes `data`. */
  attributes: Clip | null
}>(() => ({ data: null, attributes: null }))

/** Copies clips (sorted by time). Returns how many were copied. */
export function copyClips(project: Project, ids: string[]): number {
  const clips = ids
    .map((id) => project.clips[id])
    .filter(Boolean)
    .sort((a, b) => a.start - b.start)
  if (!clips.length) return 0
  const assetIds = new Set(clips.map((c) => c.assetId).filter((id): id is string => Boolean(id)))
  useClipboard.setState({
    data: {
      clips: structuredClone(clips),
      assets: structuredClone([...assetIds].map((id) => project.assets[id]).filter(Boolean)),
      start: Math.min(...clips.map((c) => c.start)),
      end: Math.max(...clips.map(clipEnd)),
    },
    // What was copied last is what attributes are pasted from.
    attributes: null,
  })
  return clips.length
}

/** Copies one clip's attributes, leaving the clips on the clipboard as they are. False when there is no such clip. */
export function copyAttributesOf(project: Project, id: string): boolean {
  const clip = project.clips[id]
  if (!clip) return false
  useClipboard.setState({ attributes: structuredClone(clip) })
  return true
}

/**
 * Pastes the clipboard so its earliest clip lands on `at`. Media the project
 * doesn't have yet is added first; it all undoes as one step. Returns the new ids.
 */
export function pasteClips(at: number, mode: EditMode = 'free'): { ok: true; ids: string[] } | { ok: false; error: string } {
  const data = useClipboard.getState().data
  if (!data?.clips.length) return { ok: false, error: tt('Nothing to paste — copy some clips first') }
  let result: { ok: true; ids: string[] } | { ok: false; error: string } = { ok: false, error: tt('Paste failed') }
  useEditor.getState().transaction(tt('Paste {0}', data.clips.length === 1 ? tt('clip') : tt('{0} clips', data.clips.length)), 'user', () => {
    const project = getProject()
    const mark = savepoint()
    for (const asset of data.assets) if (!project.assets[asset.id]) dispatch('asset.add', { asset })
    // Clips are plain project data; the snapshot schema checks them on the way in.
    const res = dispatch('clip.paste', { clips: data.clips as unknown as ClipSnapshot[], at, mode })
    result = res.ok ? { ok: true, ids: res.result as string[] } : { ok: false, error: res.error }
    // A paste that fails leaves no media behind.
    if (!res.ok && mark) rollbackTo(mark)
  })
  return result
}

const sourceOf = (s: { data: ClipboardData | null; attributes: Clip | null }) => s.attributes ?? s.data?.clips[0] ?? null

/** The one clip that attributes can be pasted from: the one they were copied from, else the first clip copied. */
export const attributeSource = () => sourceOf(useClipboard.getState())

/** The same, for a component: it draws again when the source changes. */
export const useAttributeSource = () => useClipboard(sourceOf)
