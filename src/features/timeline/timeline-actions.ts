/**
 * Actions of the timeline's tools, shared by shortcuts, menus, the command
 * palette and buttons: one implementation, many entry points.
 */
import { toast } from 'sonner'
import { clipsAt } from '@/editor/ops'
import { usePlayback } from '@/editor/playback'
import { dispatch, getProject, useEditor } from '@/editor/store'
import { canHaveTakes, type SwitchResult } from '@/editor/takes'
import type { Clip } from '@/editor/types'
import { useUI } from '@/editor/ui-store'
import { useMediaSelection } from '@/features/assets/media-selection'
import { formatDuration } from '@/lib/time'

const ui = () => useUI.getState()
const frame = () => usePlayback.getState().frame
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** The selected clips, or else the top clip under the playhead. */
function targetClips(accept: (c: Clip) => boolean = () => true): Clip[] {
  const p = getProject()
  const selected = ui()
    .selection.map((id) => p.clips[id])
    .filter(Boolean)
  if (selected.length) return selected.filter(accept)
  const order = new Map(p.tracks.map((t, i) => [t.id, i]))
  return clipsAt(p, frame())
    .filter(accept)
    .sort((a, b) => (order.get(a.trackId) ?? 0) - (order.get(b.trackId) ?? 0))
    .slice(0, 1)
}

/** What a take switch did to the clip's length or the take's start, for a toast. */
function takeNote(r: SwitchResult, fps: number) {
  if (r.shortenedBy) return `It is ${formatDuration(r.shortenedBy, fps)} shorter than the place: the clip got shorter, and gets its length back with a longer take.`
  if (r.slidBack) return `It starts ${formatDuration(r.slidBack, fps)} earlier than marked, so it fills the place.`
  return undefined
}

export const timelineActions = {
  /** Shows the next (or previous) take of the selected clips. */
  switchTake(step: 1 | -1) {
    const clips = targetClips((c) => Boolean(c.takes && c.takes.length > 1))
    if (!clips.length) return void toast('No alternate takes here', { description: 'Add one from the clip’s menu, or drop media on a clip while holding Alt.' })
    const fps = getProject().settings.fps
    useEditor.getState().transaction(step > 0 ? 'Next take' : 'Previous take', 'user', () => {
      for (const c of clips) {
        const res = dispatch('take.switch', { clipId: c.id, step })
        if (!res.ok) toast(res.error)
        else if (clips.length === 1) {
          const now = getProject().clips[c.id]
          const i = (now.takes?.findIndex((t) => t.id === now.takeId) ?? 0) + 1
          toast(`Take ${i} of ${now.takes?.length ?? 1}: ${now.takes?.[i - 1]?.name ?? now.name}`, { description: takeNote(res.result as SwitchResult, fps), duration: 2200 })
        }
      }
    })
  },

  /** Adds media as takes of a clip: the ones given, else the ones selected in the Media panel. Shows the last one added. */
  addTakes(clipId?: string, assetIds?: string[]) {
    const p = getProject()
    const clip = clipId ? p.clips[clipId] : targetClips(canHaveTakes)[0]
    if (!clip) return void toast('Select a video, image or audio clip first')
    const ids = (assetIds ?? useMediaSelection.getState().ids).filter((id) => p.assets[id] && id !== clip.assetId)
    if (!ids.length) return void toast('Select the other takes in the Media panel first', { description: 'Then choose “Add the selected media as takes” — or drop media on the clip while holding Alt.' })
    let added = 0
    let last: SwitchResult | undefined
    let error: string | undefined
    useEditor.getState().transaction(`Add ${plural(ids.length, 'take')}`, 'user', () => {
      ids.forEach((assetId, i) => {
        const res = dispatch('take.add', { clipId: clip.id, assetId, show: i === ids.length - 1 })
        if (res.ok) {
          added++
          last = res.result as SwitchResult
        } else error = res.error
      })
    })
    if (!added) return void toast(error ?? 'Nothing was added')
    ui().select([clip.id])
    toast.success(`Added ${plural(added, 'take')}`, { description: (last && takeNote(last, p.settings.fps)) ?? (error ? `One was left out: ${error}` : 'Alt+T shows the next one, Alt+Shift+T the one before.') })
  },
}
