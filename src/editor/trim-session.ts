/**
 * Dynamic trimming: trim mode while it is on. One cut is picked out, and the
 * transport trims it — play with J and L, and where playback stops (K) is
 * where the cut goes.
 *
 * Trimming the out side, or rolling, the cut follows the playhead as it plays:
 * the viewer shows the outgoing shot running on (or back), and the frame it
 * stops on is that shot's last. Trimming the in side, the incoming shot simply
 * plays, and the frame it stops on becomes its first.
 *
 * Whatever a stretch of playing or nudging does is one undo step: every move
 * is worked out from the timeline as it was when the stretch began.
 */
import { create } from 'zustand'
import { clamp } from '@/lib/math'
import { playback, usePlayback } from './playback'
import { dispatch, getProject, undoEntry, useEditor } from './store'
import { nearestCut, refreshCut, trimLimits, trimSides, trimStep, type TrimCut, type TrimSide } from './trim-mode'
import type { Frame, Project } from './types'
import { useUI } from './ui-store'
import { tt } from '@/lib/i18n'

interface TrimState {
  /** The cut being trimmed, where it is now; null when trim mode is off. */
  cut: TrimCut | null
  side: TrimSide
  /** Frames this stretch of trimming has moved the side so far (shown next to the cut). */
  moved: number
}

export const useTrim = create<TrimState>(() => ({ cut: null, side: 'roll', moved: 0 }))

const LABEL: Record<TrimSide, string> = { roll: tt('Roll the cut'), out: tt('Trim the out point'), in: tt('Trim the in point') }

/** The timeline and the cut as they were when this stretch of trimming began. */
let base: { project: Project; cut: TrimCut } | null = null
/** The history entry holding this stretch's trim, once it has made one. */
let live: number | null = null
/** True while the session itself is editing or moving the playhead, so its own listeners stand back. */
let busy = false

const state = () => useTrim.getState()

/** The frame the viewer watches: the incoming shot's first frame for `in`, the outgoing shot's last otherwise. */
const watchFrame = (cut: TrimCut, side: TrimSide) => (side === 'in' ? cut.frame : Math.max(0, cut.frame - 1))

function quietly<T>(fn: () => T): T {
  const was = busy
  busy = true
  try {
    return fn()
  } finally {
    busy = was
  }
}

function park() {
  const { cut, side } = state()
  if (cut) quietly(() => playback.seek(watchFrame(cut, side)))
}

/** Starts a new stretch from the timeline as it is now. */
function rebase(cut: TrimCut, side = state().side) {
  base = { project: getProject(), cut }
  live = null
  useTrim.setState({ cut, side, moved: 0 })
}

/**
 * Takes the side to `frame` (within what the footage allows), from where this
 * stretch began — so however many moves a stretch makes, history holds one.
 */
function apply(frame: Frame) {
  if (!base) return
  const { side } = state()
  quietly(() => {
    if (live !== null && !undoEntry(live)) {
      // Something else was edited since: this stretch ends there, and a new one starts from what there is now.
      const now = refreshCut(getProject(), base!.cut)
      if (!now) return void exitTrim()
      rebase(now)
    }
    live = null
    const from = base!
    const step = trimStep(from.project, from.cut, side, frame)
    if (step) {
      const res = dispatch(step.command as 'clip.trim', step.input as never, { label: LABEL[side] })
      if (res.ok) live = useEditor.getState().past.at(-1)?.id ?? null
    }
    const cut = refreshCut(getProject(), from.cut)
    if (!cut) return void exitTrim()
    useTrim.setState({ cut, moved: step ? step.frame - from.cut.frame : 0 })
  })
}

/** Ends the stretch: what it did stays as one undo step, and the next move starts a new one. */
function settle() {
  const { cut } = state()
  if (cut) rebase(cut)
}

/** Whether trim mode is on. */
export const trimming = () => state().cut !== null

/**
 * Turns trim mode on for a cut — the one given, else the one nearest the
 * playhead (a cut on a selected clip first). False when there is no cut to trim.
 */
export function enterTrim(cut?: TrimCut, side?: TrimSide): boolean {
  const project = getProject()
  const target = cut ?? nearestCut(project, usePlayback.getState().frame, useUI.getState().selection)
  if (!target) return false
  const sides = trimSides(target, project)
  if (!sides.length) return false
  if (usePlayback.getState().playing) quietly(() => playback.pause())
  rebase(target, side && sides.includes(side) ? side : sides[0])
  useUI.getState().select([target.left, target.right].filter((id): id is string => Boolean(id)))
  park()
  return true
}

export function exitTrim() {
  if (!trimming()) return
  base = null
  live = null
  useTrim.setState({ cut: null, moved: 0 })
}

/** Switches to the next side the cut has (roll → out → in), or to the one given. */
export function setTrimSide(next?: TrimSide) {
  const { cut, side } = state()
  if (!cut) return
  const sides = trimSides(cut, getProject())
  const to = next && sides.includes(next) ? next : sides[(sides.indexOf(side) + 1) % sides.length]
  if (to === side) return
  if (usePlayback.getState().playing) quietly(() => playback.pause())
  rebase(cut, to)
  park()
}

/** Moves the side by a few frames (the arrow keys). Presses in a row are one undo step. */
export function nudgeTrim(delta: number) {
  const { cut, moved } = state()
  if (!cut || !base) return
  if (usePlayback.getState().playing) quietly(() => playback.pause())
  apply(base.cut.frame + moved + delta)
  if (trimming()) park()
}

/**
 * Where the playhead stopped is where the side goes: the frame showing becomes
 * the incoming shot's first (`in`) or the outgoing shot's last (the other sides,
 * which have been following all along while it played).
 */
function stopped(frame: Frame) {
  const { cut, side } = state()
  if (!cut || !base) return
  apply(side === 'in' ? frame : frame + 1)
  if (!trimming()) return
  settle()
  park()
}

/** The keys trim mode takes for itself; the transport keys (J, L, Space) are left to do what they always do. */
export function handleTrimKey(e: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'ctrlKey' | 'metaKey' | 'altKey'>): boolean {
  if (!trimming() || e.ctrlKey || e.metaKey || e.altKey) return false
  switch (e.key.toLowerCase()) {
    case 'k':
      if (usePlayback.getState().playing) playback.pause()
      else stopped(usePlayback.getState().frame)
      return true
    case 'arrowleft':
      nudgeTrim(e.shiftKey ? -5 : -1)
      return true
    case 'arrowright':
      nudgeTrim(e.shiftKey ? 5 : 1)
      return true
    case 'tab':
      setTrimSide()
      return true
    case 'escape':
    case 'enter':
    case 't':
      exitTrim()
      return true
  }
  return false
}

// The transport drives the trim.
usePlayback.subscribe((s, prev) => {
  const { cut, side } = state()
  if (!cut || !base || busy) return
  if (s.playing && !prev.playing) {
    // Playing always sets off from the cut, wherever the playhead had wandered.
    const from = watchFrame(cut, side)
    if (s.frame !== from) quietly(() => playback.seek(from))
    return
  }
  if (!s.playing && prev.playing) return void stopped(s.frame)
  if (!s.playing || s.frame === prev.frame) return
  const [lo, hi] = trimLimits(base.project, base.cut, side)
  if (side === 'in') {
    // The incoming shot plays; it has nothing to show past its last frame.
    if (s.frame >= hi || s.frame <= lo) playback.pause()
    return
  }
  // The cut sits just after the frame being watched.
  const want = s.frame + 1
  apply(clamp(want, lo, hi))
  if (want >= hi || want <= lo) playback.pause()
})

// An edit made some other way (undo, a drag, the Copilot) moves things under the session: it carries on from there, or ends.
useEditor.subscribe((s, prev) => {
  const { cut } = state()
  if (!cut || busy || s.project === prev.project) return
  const now = refreshCut(s.project, cut)
  if (!now) return void exitTrim()
  rebase(now)
})
