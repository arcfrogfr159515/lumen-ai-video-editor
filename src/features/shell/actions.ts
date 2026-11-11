/**
 * App-level actions shared by keyboard shortcuts, menus, the command palette
 * and toolbar buttons — one implementation, many entry points.
 */
import { toast } from 'sonner'
import { copyAttributesOf, copyClips, pasteClips } from '@/editor/clipboard'
import type { EditMode } from '@/editor/commands'
import { clipCues, cueText, cueTone } from '@/editor/cues'
import { isAnimated } from '@/editor/keyframes'
import { adjacentBefore, clipEnd, clipsAt, editPoints, projectDuration, withGroups } from '@/editor/ops'
import { playback, usePlayback } from '@/editor/playback'
import { dispatch, getProject, useEditor } from '@/editor/store'
import { useTimelineView } from '@/editor/timeline-view'
import type { InspectorTab, Tool } from '@/editor/ui-store'
import { useUI } from '@/editor/ui-store'
import { importDropped, pickAndImport } from '@/project/media-import'
import { openProject, saveProject, saveProjectAs, showHome } from '@/project/session'
import { openTimeline } from '@/editor/timeline-nav'
import { AnalysisCancelled, initialTrackBox, NOTHING_TO_FOLLOW, scenesInClip, stabilizeClip, trackingSource, withProgress } from '@/project/analysis-actions'
import { deleteRenders, renderPreviews } from '@/engine/render-cache'
import { analyzeBeats, beatsOf, cutToBeats } from '@/project/beats'
import { onSegmentProgress, type MatteProgress, type Subject } from '@/project/segment'
import { cutOutSubject, textBehindSubject } from '@/project/subject'
import { addCaptions, removePauses, untranscribed } from '@/editor/smart'
import type { CaptionStyle } from '@/editor/subtitles'
import type { Clip } from '@/editor/types'
import { ensureTranscripts } from '@/project/transcribe'
import { counted, tt } from '@/lib/i18n'
import { wrapDegrees } from '@/lib/math'

const ui = () => useUI.getState()

/**
 * Runs a subject-matte job with a progress toast (the model's one-time
 * download included) and a Cancel button.
 */
async function withMatteProgress<T>(title: string, run: (opts: { onProgress: (p: MatteProgress) => void; signal: AbortSignal }) => Promise<T>) {
  const ctl = new AbortController()
  const id = toast.loading(title, { action: { label: tt('Cancel'), onClick: () => ctl.abort() }, duration: Infinity })
  const show = (description: string) => toast.loading(title, { id, description, action: { label: tt('Cancel'), onClick: () => ctl.abort() }, duration: Infinity })
  const off = onSegmentProgress((m) => {
    if (m.type === 'progress' && m.status === 'progress' && m.total) show(tt('Downloading the model (once) — {0} of {1} MB', Math.round((m.loaded ?? 0) / 1048576), Math.round(m.total / 1048576)))
    else if (m.type === 'ready') show(tt('Model ready ({0})', m.device === 'webgpu' ? tt('GPU') : tt('CPU')))
  })
  try {
    const result = await run({
      signal: ctl.signal,
      onProgress: (p) => p.total && show(tt('{0}% — frame {1} of {2}', Math.round((p.done / p.total) * 100), p.done, p.total)),
    })
    toast.success(title.replace(/…$/, ''), { id, description: tt('Done'), action: undefined, duration: 3000 })
    return result
  } catch (err) {
    if (ctl.signal.aborted || (err instanceof Error && err.message === 'Cancelled')) toast(tt('Stopped'), { id, description: undefined, action: undefined, duration: 2000 })
    else toast.error(title.replace(/…$/, ' failed'), { id, description: err instanceof Error ? err.message : String(err), action: undefined, duration: 8000 })
    return null
  } finally {
    off()
  }
}
const frame = () => usePlayback.getState().frame
const plural = counted

/** Shows a failed dispatch; true when it worked. */
function ok(res: { ok: true } | { ok: false; error: string }) {
  if (!res.ok) toast(res.error)
  return res.ok
}

/** The selected clips, or else the top video clip under the playhead. */
function targetClips(kinds?: string[]) {
  const p = getProject()
  const selected = ui().selection.map((id) => p.clips[id]).filter(Boolean)
  if (selected.length) return kinds ? selected.filter((c) => kinds.includes(c.kind)) : selected
  const order = new Map(p.tracks.map((t, i) => [t.id, i]))
  return clipsAt(p, frame())
    .filter((c) => !kinds || kinds.includes(c.kind))
    .sort((a, b) => (order.get(a.trackId) ?? 0) - (order.get(b.trackId) ?? 0))
    .slice(0, 1)
}

const hasPicture = (c: Clip) => c.kind !== 'audio' && c.kind !== 'adjustment'

/**
 * Turns the selected picture clips by an angle on one of their axes, as one undo step. A clip whose angle is
 * keyframed is left as it is: a keyframe holds the angle at one moment, not for the whole clip.
 */
function turnClips(prop: 'rotation' | 'rotateY', by: number, label: string, nothing: string) {
  const clips = targetClips().filter(hasPicture)
  if (!clips.length) return void toast(nothing)
  const free = clips.filter((c) => !isAnimated(c, prop))
  if (!free.length) return void toast(tt('“{0}” has keyframes on that angle', clips[0].name), { description: tt('Change it at its keyframes, in the inspector.') })
  useEditor.getState().transaction(label, 'user', () => {
    for (const c of free) dispatch('clip.update', { ids: [c.id], patch: { transform: { [prop]: wrapDegrees((c.transform[prop] ?? 0) + by) } } })
  })
}

export const actions = {
  undo() {
    const entry = useEditor.getState().undo()
    if (entry?.source === 'ai') toast(tt('Undid Copilot: {0}', entry.label))
  },
  redo() {
    useEditor.getState().redo()
  },

  split() {
    const f = frame()
    const selected = ui().selection
    const underPlayhead = clipsAt(getProject(), f, selected)
    const ids = selected.length && underPlayhead.length ? underPlayhead.map((c) => c.id) : undefined
    const res = dispatch('clip.split', { frame: f, ids })
    if (!res.ok) toast(res.error)
  },

  deleteSelection(ripple = false) {
    const ids = ui().selection
    if (!ids.length) return
    const res = dispatch('clip.delete', { ids, ripple })
    if (res.ok) ui().clearSelection()
    else toast(res.error)
  },

  duplicateSelection() {
    const ids = ui().selection
    if (!ids.length) return
    const res = dispatch('clip.duplicate', { ids })
    if (res.ok) ui().select(res.result as string[])
  },

  // ── Clipboard ──

  copy() {
    const n = copyClips(getProject(), ui().selection)
    if (n) toast(tt('Copied {0}', plural(n, 'clip')))
  },

  cut() {
    const ids = ui().selection
    if (!copyClips(getProject(), ids)) return
    if (ok(dispatch('clip.delete', { ids, ripple: false }, { label: tt('Cut {0}', plural(ids.length, 'clip')) }))) ui().clearSelection()
  },

  /** Pastes at the playhead (or `at`): free finds room, insert pushes clips later, overwrite covers them. */
  paste(mode: EditMode = 'free', at = frame()) {
    const res = pasteClips(at, mode)
    if (!res.ok) return void toast(res.error)
    ui().select(res.ids)
  },

  /** Copies one clip's attributes (the clip given, else the first selected) for Paste attributes. The clips on the clipboard stay. */
  copyAttributes(clipId?: string) {
    const clip = getProject().clips[clipId ?? ui().selection[0] ?? '']
    if (!clip || !copyAttributesOf(getProject(), clip.id)) return void toast(tt('Select a clip to copy its attributes'))
    toast(tt('Copied the attributes of “{0}”', clip.name))
  },

  pasteAttributes() {
    if (!ui().selection.length) return void toast(tt('Select the clips to paste attributes onto'))
    ui().setPasteAttributesOpen(true)
  },

  // ── Linking & holds ──

  detachAudio() {
    const clips = targetClips(['video']).filter((c) => !c.audio.detached)
    if (!clips.length) return void toast(tt('Select a video clip with sound to detach its audio'))
    const res = dispatch('clip.detachAudio', { ids: clips.map((c) => c.id) })
    if (ok(res)) ui().select([...clips.map((c) => c.id), ...(res.result as string[])])
  },

  reattachAudio() {
    const clips = targetClips(['video']).filter((c) => c.audio.detached)
    if (!clips.length) return void toast(tt('Select a video clip whose sound was detached'))
    ok(dispatch('clip.reattachAudio', { ids: clips.map((c) => c.id) }))
  },

  toggleAudioLink() {
    const clips = targetClips(['video'])
    if (clips.some((c) => c.audio.detached)) actions.reattachAudio()
    else actions.detachAudio()
  },

  group() {
    const ids = ui().selection
    if (ids.length < 2) return void toast(tt('Select two or more clips to group'))
    if (ok(dispatch('clip.group', { ids }))) toast(tt('Grouped {0}', plural(withGroups(getProject(), ids).length, 'clip')))
  },

  ungroup() {
    const ids = ui().selection
    if (!ids.some((id) => getProject().clips[id]?.groupId)) return void toast(tt('Nothing selected is grouped'))
    ok(dispatch('clip.ungroup', { ids }))
  },

  /** Holds the frame under the playhead for two seconds. */
  freezeFrame() {
    const f = frame()
    const clip = targetClips(['video']).find((c) => f >= c.start && f < clipEnd(c))
    if (!clip) return void toast(tt('Put the playhead over a video clip to freeze a frame'))
    const res = dispatch('clip.freeze', { id: clip.id, frame: f, duration: getProject().settings.fps * 2 })
    if (ok(res)) ui().select([res.result as string])
  },

  /** Crossfades each selected clip with the one before it (a dissolve on video, a crossfade on sound). */
  crossfade() {
    const p = getProject()
    const clips = targetClips().filter((c) => adjacentBefore(p, c))
    if (!clips.length) return void toast(tt('Select a clip that directly follows another to crossfade them'))
    const duration = Math.round(p.settings.fps / 2)
    useEditor.getState().transaction(clips.length > 1 ? tt('Add crossfades') : tt('Add crossfade'), 'user', () => {
      for (const c of clips) dispatch('clip.setTransition', { id: c.id, transition: c.transitionIn ?? { kind: 'dissolve', duration: Math.max(2, Math.min(duration, c.duration)) } })
    })
  },

  // ── The picture ──

  /**
   * Mirrors the selected clips left to right. The clip is turned half-way round its upright axis (Turn Y in the
   * inspector), so what faces the viewer is its mirror image; doing it again turns it back.
   */
  mirror() {
    turnClips('rotateY', 180, tt('Mirror'), tt('Select a video, image or title clip to mirror'))
  },

  /** Turns the selected clips a quarter turn clockwise. */
  rotate() {
    turnClips('rotation', 90, tt('Rotate'), tt('Select a video, image or title clip to rotate'))
  },

  /** Crops a clip on the canvas: it is selected, shown in the viewer, and its edges can be dragged there. */
  cropOnCanvas(clipId?: string) {
    const clip = clipId ? getProject().clips[clipId] : targetClips(['video', 'image'])[0]
    if (!clip || (clip.kind !== 'video' && clip.kind !== 'image')) return void toast(tt('Select a video or image clip to crop'))
    const f = frame()
    if (f < clip.start || f >= clipEnd(clip)) {
      playback.pause()
      playback.seek(clip.start)
    }
    // Selecting leaves crop mode, so the clip is selected first.
    ui().select([clip.id])
    ui().setRightTab('inspector')
    ui().setInspectorTab('video')
    ui().setCropMode(true)
  },

  /** A clip in the inspector, on one of its panes (where its effects are, or its speed ramp). */
  showInInspector(clipId: string, tab: InspectorTab) {
    if (!getProject().clips[clipId]) return
    ui().select([clipId])
    ui().setRightTab('inspector')
    ui().setInspectorTab(tab)
  },

  /** Exports the stretch the selected clips cover: marks in and out around them and opens Export, which offers that range. */
  exportSelection() {
    if (!ui().selection.some((id) => getProject().clips[id])) return void toast(tt('Select the clips to export first'))
    actions.markSelection()
    ui().setExportOpen(true)
  },

  /**
   * Cuts the long pauses out of the speech in the selected clips. The whole timeline closes up around each one,
   * so captions and B-roll stay in step, and music plays on through the joins.
   */
  async removePauses() {
    const clips = targetClips(['video', 'audio']).filter((c) => c.assetId && !c.freeze)
    if (!clips.length) return void toast(tt('Select a clip with speech first'))
    const id = toast.loading(tt('Listening for pauses…'))
    try {
      const r = await removePauses({ clipIds: clips.map((c) => c.id) })
      if (r.removed) toast.success(tt('Removed {0} pauses ({1}s)', r.removed, r.seconds.toFixed(1)), { id })
      else toast(tt('No long pauses to remove'), { id, description: tt('Pauses shorter than 0.6 s are left as they are.') })
    } catch (err) {
      toast.error(tt('Couldn’t remove the pauses'), { id, description: err instanceof Error ? err.message : String(err) })
    }
  },

  // ── Timelines & multicam ──

  /** Moves the selected clips (and anything linked) into a new timeline played by one clip. */
  nestSelection() {
    const ids = ui().selection
    if (!ids.length) return void toast(tt('Select the clips to nest first'))
    const res = dispatch('clip.nest', { ids })
    if (!ok(res)) return
    const { clipId, sequenceId } = res.result as { clipId: string; sequenceId: string }
    ui().select([clipId])
    toast.success(tt('Nested into a new timeline'), { action: { label: tt('Open it'), onClick: () => openTimeline(sequenceId, true) } })
  },

  /** Steps into the timeline a nested clip plays. */
  openNested(clipId?: string) {
    const id = clipId ?? ui().selection.find((x) => getProject().clips[x]?.sequenceId)
    const seq = id ? getProject().clips[id]?.sequenceId : undefined
    if (seq) openTimeline(seq, true)
  },

  /** Brings a nested clip's contents back onto this timeline. */
  unnestSelection() {
    const id = ui().selection.find((x) => getProject().clips[x]?.sequenceId)
    if (!id) return void toast(tt('Select a nested clip to break apart'))
    const res = dispatch('clip.unnest', { id })
    if (ok(res)) ui().select(res.result as string[])
  },

  /** Multicam: cut to camera `n` (1–9) at the playhead. */
  cutToAngle(n: number) {
    const p = getProject()
    const f = frame()
    if (!clipsAt(p, f).some((c) => c.sequenceId && p.sequences?.[c.sequenceId]?.multicam)) return
    ok(dispatch('multicam.switch', { frame: f, angle: n }))
  },

  // ── Reading the footage ──

  /** Splits the selected video clip (or the one under the playhead) where its shots change — or marks them. */
  async detectScenes(action: 'split' | 'markers' | 'guides' = 'split') {
    const clip = targetClips(['video']).find((c) => c.assetId)
    if (!clip) return void toast(tt('Select a video clip first'))
    try {
      const r = await withProgress(tt('Finding scene cuts'), (onProgress, signal) => scenesInClip(clip.id, { action: action === 'guides' ? 'none' : action }, onProgress, signal))
      if (!r.cuts.length) toast(tt('No scene cuts found in that clip'))
      else if (action === 'guides') {
        // Found cuts are kept on the media either way; this makes sure they are on show.
        useTimelineView.getState().set({ cutGuides: true })
        toast.success(tt('Found {0}', plural(r.cuts.length, 'scene cut')), { description: tt('Shown as guides in the clip. Trims, moves and the blade snap to them.') })
      } else toast.success(`${action === 'split' ? 'Split at' : 'Marked'} ${plural(r.cuts.length, 'scene cut')}`)
    } catch (err) {
      if (!(err instanceof AnalysisCancelled)) toast.error(tt('Scene detection failed'), { description: err instanceof Error ? err.message : String(err) })
    }
  },

  /** Smooths the camera shake out of the selected video clip. */
  async stabilize(clipId?: string) {
    const clip = clipId ? getProject().clips[clipId] : targetClips(['video']).find((c) => c.assetId)
    if (!clip) return void toast(tt('Select a video clip first'))
    try {
      const r = await withProgress('Stabilizing', (onProgress, signal) => stabilizeClip(clip.id, {}, onProgress, signal))
      toast.success(tt('Stabilized'), { description: r.zoom > 1.001 ? tt('Zoomed in {0}% to hide the moving edges.', Math.round((r.zoom - 1) * 100)) : undefined })
    } catch (err) {
      if (!(err instanceof AnalysisCancelled)) toast.error(tt('Couldn’t stabilize'), { description: err instanceof Error ? err.message : String(err) })
    }
  },

  /** Starts placing a box on the preview for the selected clip (or its mask) to follow. */
  trackMotion(clipId?: string, maskId?: string) {
    const clip = clipId ? getProject().clips[clipId] : targetClips().find((c) => c.kind !== 'audio')
    if (!clip) return void toast(tt('Select the clip that should follow something'))
    const f = frame()
    if (f < clip.start || f >= clipEnd(clip)) return void toast(tt('Put the playhead over the clip, on a frame where what it should follow is visible'))
    if (!maskId && clip.kind === 'adjustment') return void toast(tt('Adjustment layers don’t move — track one of their masks instead'))
    const p = getProject()
    // Tracking reads the video under the clip. Asked for on the footage itself, with nothing under it,
    // it follows something in that footage: with the clip lying over it, or else with a new title.
    let target = clip
    let newTitle = false
    if (!trackingSource(p, clip, f, Boolean(maskId))) {
      const footage = clip.kind === 'video' && !clip.sequenceId && p.assets[clip.assetId ?? '']?.kind === 'video'
      if (!footage) return void toast(tt('Nothing to follow here'), { description: NOTHING_TO_FOLLOW })
      const order = new Map(p.tracks.map((t, i) => [t.id, i]))
      const level = order.get(clip.trackId) ?? 0
      const above = Object.values(p.clips)
        .filter((c) => c.kind !== 'audio' && c.kind !== 'adjustment' && (order.get(c.trackId) ?? 0) < level && f >= c.start && f < clipEnd(c) && p.tracks.find((t) => t.id === c.trackId)?.kind === 'video')
        .sort((a, b) => (order.get(b.trackId) ?? 0) - (order.get(a.trackId) ?? 0))[0]
      if (above) {
        target = above
        toast(tt('“{0}” will follow what you box', above.name), { description: tt('It’s the clip over this footage. Select another clip first to make that one follow instead.') })
      } else newTitle = true
    }
    playback.pause()
    ui().select([target.id])
    ui().setTrackEdit({ clipId: target.id, maskId, newTitle, box: initialTrackBox(p, target, maskId, f) })
  },

  // ── In & out points ──

  markIn() {
    const f = frame()
    const r = getProject().range
    const end = projectDuration(getProject())
    const out = r && r.out > f ? r.out : Math.max(f + 1, end)
    dispatch('timeline.setRange', { range: { in: f, out } })
  },

  markOut() {
    const f = Math.max(1, frame())
    const r = getProject().range
    dispatch('timeline.setRange', { range: { in: r && r.in < f ? r.in : 0, out: f } })
  },

  /** Marks in and out around the selected clips. */
  markSelection() {
    const clips = ui().selection.map((id) => getProject().clips[id]).filter(Boolean)
    if (!clips.length) return
    dispatch('timeline.setRange', { range: { in: Math.min(...clips.map((c) => c.start)), out: Math.max(...clips.map(clipEnd)) } })
  },

  clearInOut() {
    if (getProject().range) dispatch('timeline.setRange', { range: null })
  },

  goToIn() {
    const r = getProject().range
    if (r) (playback.pause(), playback.seek(r.in))
  },

  goToOut() {
    const r = getProject().range
    if (r) (playback.pause(), playback.seek(Math.max(r.in, r.out - 1)))
  },

  /** Lift: clears the marked stretch on every unlocked track and leaves the gap. */
  lift() {
    const r = getProject().range
    if (!r) return void toast(tt('Mark in (I) and out (O) first'))
    ok(dispatch('timeline.liftRange', { start: r.in, end: r.out }))
  },

  /** Extract: takes the marked stretch out and closes the gap. */
  extract() {
    const r = getProject().range
    if (!r) return void toast(tt('Mark in (I) and out (O) first'))
    if (ok(dispatch('timeline.removeRange', { start: r.in, end: r.out }, { label: tt('Extract') }))) playback.seek(r.in)
  },

  playInToOut() {
    playback.playInToOut()
  },

  /** Text behind the subject: the clip, a title (the selected one, or a new one), and the subject cut out on top. */
  async textBehindSubject(clipId: string, subject: Subject = 'person') {
    const sel = ui().selection.map((id) => getProject().clips[id]).filter(Boolean)
    const title = sel.find((c) => c.kind === 'text')
    await withMatteProgress(tt('Putting the text behind the subject…'), (o) => textBehindSubject(clipId, { ...o, subject, titleId: title?.id }))
  },

  /** Cuts a clip down to its subject, or (invert) removes the subject. */
  async cutOutSubject(clipId: string, subject: Subject = 'person', invert = false) {
    await withMatteProgress(invert ? tt('Removing the subject…') : tt('Cutting out the subject…'), (o) => cutOutSubject(clipId, { ...o, subject, invert }))
  },

  /** Finds a music clip's beat (tempo, beats and downbeats); its waveform then shows them and cuts snap to them. */
  async detectBeats(clipId: string) {
    const clip = getProject().clips[clipId]
    if (!clip?.assetId) return
    const id = toast.loading(tt('Listening for the beat…'))
    try {
      const grid = await analyzeBeats(clip.assetId)
      toast.success(grid.times.length ? tt('{0} BPM — {1} beats', Math.round(grid.bpm), grid.times.length) : tt('No steady beat in this one'), { id, description: grid.times.length ? tt('Cuts now snap to the beat.') : undefined })
    } catch (err) {
      toast.error(tt('Couldn’t find the beat'), { id, description: err instanceof Error ? err.message : String(err) })
    }
  },

  /** Markers where a clip's cues fall (the lines said, cuts and sounds its sender listed), for building the soundtrack. */
  cueMarkers(clipId: string) {
    const p = getProject()
    const clip = p.clips[clipId]
    if (!clip) return
    const cues = clipCues(clip, clip.assetId ? p.assets[clip.assetId] : undefined, p.settings.fps)
    if (!cues.length) return void toast.message(tt('This clip has no cues'))
    const colors = { speech: 'lime', cut: 'sky', sound: 'emerald', action: 'amber' } as const
    useEditor.getState().transaction(tt('Cue markers'), 'user', () => {
      for (const c of cues) dispatch('marker.add', { frame: clip.start + c.frame, label: cueText(c.cue).slice(0, 80), color: colors[cueTone(c.cue.kind)] })
    })
    toast.success(tt('Added {0} marker{1} at the cues', cues.length, cues.length > 1 ? 's' : ''))
  },

  /** Markers on a music clip's downbeats (the first beat of each bar). */
  async beatMarkers(clipId: string) {
    const clip = getProject().clips[clipId]
    if (!clip) return
    try {
      const { beats } = await beatsOf(clip)
      const downs = beats.filter((b) => b.down)
      useEditor.getState().transaction(tt('Beat markers'), 'user', () => {
        for (const b of downs) dispatch('marker.add', { frame: b.frame, label: tt('Bar'), color: 'sky' })
      })
      toast.success(tt('Added {0} markers on the downbeats', downs.length))
    } catch (err) {
      toast.error(tt('Couldn’t find the beat'), { description: err instanceof Error ? err.message : String(err) })
    }
  },

  /** Lays the selected clips out one after another on the music's beat. */
  async cutToBeats(every = 2) {
    const ids = ui().selection.filter((id) => getProject().clips[id]?.kind !== 'audio')
    const id = toast.loading(tt('Cutting to the beat…'))
    try {
      const res = await cutToBeats(ids, { every })
      toast.success(tt('Cut {0} clips to the beat ({1} BPM)', res.placed.length, Math.round(res.bpm)), { id })
    } catch (err) {
      toast.error(tt('Couldn’t cut to the beat'), { id, description: err instanceof Error ? err.message : String(err) })
    }
  },

  /** Captions all the speech on the timeline in a style, transcribing what needs it first. Replaces earlier captions. */
  async captionSpeech(style: CaptionStyle = 'clean') {
    const pending = untranscribed(getProject())
    if (pending.length && !(await ensureTranscripts(pending))) return
    const r = addCaptions({ style, source: 'user' })
    if (!r.added) toast(tt('No speech to caption'), { description: tt('Put a clip of someone talking on the timeline first.') })
    else toast.success(tt('Added {0}', plural(r.added, 'caption')), { description: tt('They’re titles on the Captions track — edit any of them like a title.') })
  },

  /** Renders previews in to out, or of the whole timeline when nothing is marked. */
  renderPreviews() {
    const p = getProject()
    if (!p.range) return actions.renderTimeline()
    void renderPreviews([p.range.in, p.range.out], tt('In to out'))
  },

  renderTimeline() {
    void renderPreviews([0, projectDuration(getProject())], tt('The whole timeline'))
  },

  renderSelection() {
    const clips = ui().selection.map((id) => getProject().clips[id]).filter(Boolean)
    if (!clips.length) return void toast(tt('Select the clips to render first'))
    void renderPreviews([Math.min(...clips.map((c) => c.start)), Math.max(...clips.map(clipEnd))], tt('Selected clips'))
  },

  /** Deletes rendered previews: in to out, or all of this project's. */
  async deleteRenders(inToOut: boolean) {
    const r = getProject().range
    await deleteRenders(inToOut && r ? [r.in, r.out] : undefined)
    toast.success(inToOut && r ? tt('Deleted the renders in to out') : tt('Deleted this project’s renders'))
  },

  setTool(tool: Tool) {
    ui().setTool(tool)
  },

  selectAll() {
    const locked = new Set(getProject().tracks.filter((t) => t.locked).map((t) => t.id))
    ui().select(Object.values(getProject().clips).filter((c) => !locked.has(c.trackId)).map((c) => c.id))
  },

  /**
   * Closes gaps. By default the tidy-up: holes where no track has anything, flash slivers and flash clips. With
   * `all`, also every gap between clips on every unlocked track, moving the later clips up.
   */
  closeGaps(all = false) {
    const p = getProject()
    const trackIds = all ? p.tracks.filter((t) => !t.locked && !t.rippleLock).map((t) => t.id) : []
    const res = dispatch('timeline.closeGaps', { trackIds })
    if (!res.ok) return void toast(res.error)
    const r = res.result as { holesClosed: number; flashGapsFilled: number; flashClipsRemoved: number; trackGapsClosed: number; left: number }
    const done = r.holesClosed + r.flashGapsFilled + r.flashClipsRemoved + r.trackGapsClosed
    if (done) toast.success(tt('Closed {0}', plural(done, 'gap')), { description: r.left ? tt('{0} left: neither neighbour has footage to cover them.', r.left) : undefined })
    else toast(tt('No gaps to close'), { description: tt('Open the clean-up tool for flash frames and uneven rates.'), action: { label: tt('Clean up'), onClick: () => useTimelineView.getState().set({ cleanup: 'gaps' }) } })
  },

  addMarker() {
    dispatch('marker.add', { frame: frame() })
  },

  zoom(factor: number) {
    ui().setZoom(ui().pxPerSecond * factor)
  },

  zoomToFit() {
    ui().requestFit()
  },

  goToStart() {
    playback.pause()
    playback.seek(0)
  },

  goToEnd() {
    playback.pause()
    playback.seek(projectDuration(getProject()))
  },

  /** Moves the playhead by whole seconds at the project frame rate. */
  stepSeconds(seconds: number) {
    playback.step(Math.round(seconds * getProject().settings.fps))
  },

  jumpEdit(direction: 1 | -1) {
    const f = frame()
    const points = editPoints(getProject())
    const target = direction > 0 ? points.find((p) => p > f) : [...points].reverse().find((p) => p < f)
    if (target !== undefined) {
      playback.pause()
      playback.seek(target)
    }
  },

  importMedia() {
    void pickAndImport()
  },

  /** Files dropped from the OS (media panel, timeline). */
  importFileList(files: File[]) {
    return importDropped(files)
  },

  async save() {
    if (await saveProject()) toast.success(tt('Project saved'))
  },

  saveAs() {
    void saveProjectAs()
  },

  open() {
    void openProject()
  },

  /** The start screen, to begin a new project or open another. */
  home() {
    showHome(true)
  },

  toggleCopilot() {
    ui().setRightTab(ui().rightTab === 'copilot' ? 'inspector' : 'copilot')
  },
}
