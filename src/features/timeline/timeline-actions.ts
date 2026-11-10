/**
 * Actions of the timeline's tools, shared by shortcuts, menus, the command
 * palette and buttons: one implementation, many entry points.
 */
import { toast } from 'sonner'
import { runMacro, startRecording, stopRecording, useMacros } from '@/editor/macro-store'
import { clipsAt, framesIn } from '@/editor/ops'
import { audioRole, pickTrack } from '@/editor/placement'
import { cutSpokenWords } from '@/editor/smart'
import { playback, usePlayback } from '@/editor/playback'
import { dispatch, getProject, useEditor } from '@/editor/store'
import { canHaveTakes, type SwitchResult } from '@/editor/takes'
import { resolveEdit } from '@/editor/three-point'
import { timelineView } from '@/editor/timeline-view'
import { enterTrim, exitTrim, trimming } from '@/editor/trim-session'
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

/** The edit the source monitor's marks, the timeline's marks and the playhead add up to right now. */
export function sourceEditFor(assetId: string) {
  const p = getProject()
  const asset = p.assets[assetId]
  if (!asset) return null
  const fps = p.settings.fps
  const { sourceMarks, fourPoint } = timelineView()
  const marks = sourceMarks[assetId] ?? {}
  const sourceIn = marks.in !== undefined ? Math.round(marks.in * fps) : undefined
  const sourceOut = marks.out !== undefined ? Math.round(marks.out * fps) : undefined
  const edit = resolveEdit(
    { sourceIn, sourceOut, timelineIn: p.range?.in, timelineOut: p.range?.out, playhead: frame(), sourceLength: asset.duration !== undefined ? framesIn(asset.duration, fps) : Infinity },
    fps,
    fourPoint,
  )
  return { asset, sourceIn, sourceOut, edit, fourPoint }
}

/**
 * Deletes words from the film: the frames they are said in come out of the
 * whole timeline, music beds staying whole. One undo step. Returns how many
 * frames went.
 */
export function cutWords(indexes: readonly number[], label?: string): number {
  const r = cutSpokenWords(indexes, { label })
  if (r.error) toast.error(r.error)
  return r.frames
}

export const timelineActions = {
  /** Opens the source monitor on a media item: the one given, else the one selected in the Media panel. */
  openSourceMonitor(assetId?: string) {
    const id = assetId ?? useMediaSelection.getState().ids[0]
    if (!id || !getProject().assets[id]) return void toast('Select a media item first', { description: 'The source monitor shows one item from the Media panel, to mark the part of it you want.' })
    timelineView().set({ sourceMonitor: { assetId: id } })
  },

  /**
   * Puts the source monitor's media on the timeline by its marks — insert pushes
   * everything later out of the way, overwrite covers what is there. `trackId`
   * picks the track; otherwise footage goes on the main track and sound on the
   * track made for it.
   */
  sourceEdit(mode: 'insert' | 'overwrite', assetId = timelineView().sourceMonitor?.assetId, trackId?: string) {
    const found = assetId ? sourceEditFor(assetId) : null
    if (!found) return void toast('Open a media item in the source monitor first')
    const { asset, sourceIn, sourceOut, edit, fourPoint } = found
    const p = getProject()
    let track = pickTrack(p, asset.kind, edit.start, edit.duration, trackId, false, asset.kind === 'audio' ? audioRole(asset) : null)
    if (!track && asset.kind === 'audio') track = pickTrack(p, 'audio', edit.start, edit.duration) ?? p.tracks.find((t) => t.kind === 'audio' && !t.locked) ?? null
    let target = track?.id
    let result: { clipId: string; start: number; duration: number; short: number } | undefined
    let error: string | undefined
    useEditor.getState().transaction(mode === 'insert' ? 'Insert edit' : 'Overwrite edit', 'user', () => {
      if (!target) {
        const made = dispatch('track.add', { kind: asset.kind === 'audio' ? 'audio' : 'video' })
        if (made.ok) target = made.result as string
      }
      if (!target) return void (error = 'There is no unlocked track for it')
      const res = dispatch('timeline.threePointEdit', { assetId: asset.id, trackId: target, at: frame(), sourceIn, sourceOut, mode, fit: fourPoint })
      if (res.ok) result = res.result as typeof result
      else error = res.error
    })
    if (!result) return void toast.error(error ?? 'The edit couldn’t be made')
    ui().select([result.clipId])
    // The playhead goes to the end of what was just laid down, ready for the next edit.
    playback.pause()
    playback.seek(result.start + result.duration)
    if (result.short) toast(`${asset.name} ran out ${formatDuration(result.short, p.settings.fps)} before the out point`, { description: 'The edit is shorter than the marked stretch.' })
  },

  /**
   * Starts recording a macro on the selected clip — or, when one is being
   * recorded, stops and keeps it. True when a recording was started.
   */
  toggleRecording(): boolean {
    if (useMacros.getState().recording) {
      const macro = stopRecording(`Macro ${useMacros.getState().macros.length + 1}`)
      if (!macro) toast('Nothing was recorded', { description: 'No edit was made to the clip while recording.' })
      else
        toast.success(`Recorded “${macro.name}” — ${plural(macro.steps.length, 'step')}`, {
          description: 'Select other clips and press Alt+Shift+R to do the same to them.',
          action: { label: 'Macros', onClick: () => timelineView().set({ macrosOpen: true }) },
          duration: 6000,
        })
      return false
    }
    const clip = targetClips()[0]
    if (!clip) {
      toast('Select the clip to record on', { description: 'A macro is a run of edits made to one clip, to do again on others.' })
      return false
    }
    ui().select([clip.id])
    startRecording(clip.id)
    toast(`Recording on “${clip.name}”`, { description: 'Edit it as you would. Alt+R stops and keeps the macro.', duration: 3500 })
    return true
  },

  /** Runs a macro (the one last recorded or run, by default) on the selected clips. */
  runMacro(id?: string) {
    const { macros, lastId, recording } = useMacros.getState()
    if (recording) return void toast('Stop recording first', { description: 'Alt+R stops and keeps the macro.' })
    const macro = macros.find((m) => m.id === (id ?? lastId))
    if (!macro) return void toast(macros.length ? 'Pick a macro to run' : 'No macro to run yet', { description: 'Timeline tools → Macros lists them and records new ones.', action: { label: 'Macros', onClick: () => timelineView().set({ macrosOpen: true }) } })
    const ids = ui().selection.filter((clipId) => getProject().clips[clipId])
    if (!ids.length) return void toast('Select the clips to run it on')
    const r = runMacro(macro, ids)
    const first = r.failed[0]
    if (!r.done) toast.error(`“${macro.name}” couldn’t be done to ${ids.length === 1 ? 'that clip' : 'any of those clips'}`, { description: first ? `“${first.name}”: ${first.why}.` : undefined, duration: 7000 })
    else
      toast.success(`“${macro.name}” on ${plural(r.done, 'clip')}`, {
        description: first ? `${plural(r.failed.length, 'clip')} left as ${r.failed.length === 1 ? 'it was' : 'they were'} — “${first.name}”: ${first.why}.` : 'One undo step.',
        duration: first ? 7000 : 2500,
      })
  },

  /** Branches the open timeline: a copy to try another cut on, which opens. */
  branch() {
    const res = dispatch('sequence.branch', {})
    if (!res.ok) return void toast(res.error)
    toast.success('You are on a branch', { description: 'Edit freely. “Compare versions” shows where it differs from the timeline it came from, and takes back what works.', action: { label: 'Compare', onClick: () => timelineView().set({ compareOpen: true }) } })
  },

  /** Brings up the batch panel: the inspector, with two or more clips selected. */
  openBatch() {
    if (ui().selection.length < 2) return void toast('Select two or more clips', { description: 'Batch changes are made in the inspector to everything selected. Ctrl+A selects every clip.' })
    ui().setRightTab('inspector')
  },

  /** Trim mode on the cut nearest the playhead (a cut on a selected clip first) — or off, if it is on. */
  toggleTrimMode() {
    if (trimming()) return exitTrim()
    if (!enterTrim()) toast('No cut to trim', { description: 'Trim mode works on a place where a clip ends or another begins.' })
  },

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
