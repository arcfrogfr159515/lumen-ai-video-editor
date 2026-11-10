/**
 * The macro recorder and library. Recording watches the commands dispatched
 * while it is on and writes down the ones made to the clip being edited;
 * macros are kept in this profile (not the project), so one recorded on
 * Monday's film is there for Tuesday's.
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { uid } from '@/lib/id'
import type { CommandName } from './commands'
import { generalize, instantiate, MacroError, madeBy, recordable, touches, type Macro, type MacroStep } from './macros'
import { beginTransaction, dispatch, endTransaction, getProject, onDispatch, rollbackTo, savepoint, useEditor, type DispatchEvent } from './store'
import type { Project } from './types'

interface RecordedStep extends MacroStep {
  /** What the command answered with, for later steps that work on what it made. */
  result: unknown
  /** The clips it made, whether or not it said so. */
  made: string[]
  /** The project before the step — before the first of them, when several were folded into one. */
  origin: Project
  /** How deep history was once the step was in it: an undo back past that takes the step with it. */
  depth: number | null
}

export interface Recording {
  /** The clip the edits are being made on. */
  clipId: string
  steps: RecordedStep[]
  /** Edits that were left out, and why (shown, so nothing is silently missing). */
  skipped: string[]
}

interface MacroState {
  macros: Macro[]
  /** The macro last recorded or run, for “run it again”. */
  lastId: string | null
  recording: Recording | null
}

export const useMacros = create<MacroState>()(
  persist(
    (): MacroState => ({ macros: [], lastId: null, recording: null }),
    { name: 'lumen.macros.v1', partialize: (s) => ({ macros: s.macros, lastId: s.lastId }) },
  ),
)

/** Steps taken back by an undo while recording, in case a redo brings them back. */
let undone: RecordedStep[] = []
/** True while a macro is being replayed: its own commands are not to be recorded. */
let replaying = false

/** Commands that set something rather than change it: one done twice in a row leaves what the second alone would. */
const SETS = new Set<CommandName>(['clip.update', 'effect.update', 'mask.update', 'clip.setTransition'])

/**
 * Whether a step says all there is to say after the one before it, so the two
 * are one step: both came of one gesture (a slider being dragged), or both set
 * the same things outright. A new speed is not such a setting — it changes
 * the clip's length from whatever length it had — unless it was one gesture.
 */
function restates(e: DispatchEvent) {
  if (e.merged) return true
  if (!SETS.has(e.name)) return false
  const patch = e.name === 'clip.update' ? (e.input as { patch?: Record<string, unknown> }).patch : undefined
  return !(patch && 'speed' in patch)
}

/**
 * The shape of a step's input: its keys and what it is addressed to (the clip,
 * a piece, an effect — the placeholders), without its numbers and words. Two
 * inputs of one shape set the same things on the same thing.
 */
const shape = (v: unknown): string => {
  if (Array.isArray(v)) return `[${v.map(shape).join(',')}]`
  if (!v || typeof v !== 'object') return '_'
  if (Object.keys(v).some((k) => k.startsWith('$'))) return JSON.stringify(v)
  return `{${Object.entries(v)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, x]) => `${k}:${shape(x)}`)
    .join(',')}}`
}

export function startRecording(clipId: string) {
  undone = []
  useMacros.setState({ recording: { clipId, steps: [], skipped: [] } })
}

export function cancelRecording() {
  undone = []
  useMacros.setState({ recording: null })
}

/** Ends the recording and keeps it as a macro (null when nothing was recorded). */
export function stopRecording(name?: string): Macro | null {
  const { recording, macros } = useMacros.getState()
  undone = []
  if (!recording?.steps.length) {
    useMacros.setState({ recording: null })
    return null
  }
  const taken = new Set(macros.map((m) => m.name.toLowerCase()))
  let label = name?.trim() || 'Macro'
  for (let n = 2; taken.has(label.toLowerCase()); n++) label = `${name?.trim() || 'Macro'} ${n}`
  const macro: Macro = { id: uid('macro'), name: label, steps: recording.steps.map(({ command, input, title }) => ({ command, input, title })), createdAt: Date.now(), fps: getProject().settings.fps }
  useMacros.setState({ macros: [...macros, macro], lastId: macro.id, recording: null })
  return macro
}

export const removeMacro = (id: string) => useMacros.setState((s) => ({ macros: s.macros.filter((m) => m.id !== id), lastId: s.lastId === id ? null : s.lastId }))

export const renameMacro = (id: string, name: string) => useMacros.setState((s) => ({ macros: s.macros.map((m) => (m.id === id && name.trim() ? { ...m, name: name.trim() } : m)) }))

/** Adds macros (from a file), giving them ids of their own. Returns how many came in. */
export function addMacros(incoming: readonly Macro[]) {
  const macros = incoming.map((m) => ({ ...m, id: uid('macro'), createdAt: m.createdAt || Date.now() }))
  useMacros.setState((s) => ({ macros: [...s.macros, ...macros] }))
  return macros.length
}

onDispatch((e) => {
  const recording = useMacros.getState().recording
  if (!recording || replaying || e.source !== 'user') return
  const note = (why: string) => useMacros.setState({ recording: { ...recording, skipped: recording.skipped.includes(why) ? recording.skipped : [...recording.skipped, why] } })
  if (!recordable(e.name)) return void note(`${e.label} — macros hold edits to clips, not to media, tracks or timelines`)
  const context = (steps: RecordedStep[]) => ({ clipId: recording.clipId, results: steps.map((s) => s.result), made: steps.map((s) => s.made) })
  if (!touches(e.name, e.input, e.before, context(recording.steps))) return void note(`${e.label} — it wasn’t made to the clip being recorded on`)
  const write = (earlier: RecordedStep[], origin: Project): RecordedStep => ({ command: e.name, input: generalize(e.name, e.input, origin, context(earlier)), title: e.label, result: e.result, made: madeBy(origin, e.after), origin, depth: null })
  const last = recording.steps[recording.steps.length - 1]
  const earlier = recording.steps.slice(0, -1)
  // Folded into the step before it, a step is written as that one was: against the project as the first of them found it.
  const folded = last && last.command === e.name && restates(e) ? write(earlier, last.origin) : null
  const steps = folded && shape(folded.input) === shape(last.input) ? [...earlier, folded] : [...recording.steps, write(recording.steps, e.before)]
  undone = []
  useMacros.setState({ recording: { ...recording, steps } })
  // History takes the step in when the edit (or the transaction around it) is done: note how deep it is then.
  queueMicrotask(() => {
    const now = useMacros.getState().recording
    if (!now) return
    const depth = useEditor.getState().past.length
    if (now.steps.some((s) => s.depth === null)) useMacros.setState({ recording: { ...now, steps: now.steps.map((s) => (s.depth === null ? { ...s, depth } : s)) } })
  })
})

// Undo takes the steps it undoes out of the recording; redo puts them back.
useEditor.subscribe((s, prev) => {
  const recording = useMacros.getState().recording
  if (!recording || s.past === prev.past) return
  const depth = s.past.length
  // History starting afresh is another project being opened: the clip being recorded on went with the old one.
  if (!depth && !s.future.length && s.project !== prev.project) return void cancelRecording()
  // An undo moves the last step of history to the front of what can be redone; a redo moves it back. (A new edit
  // also empties what can be redone — but what it puts in history is new.)
  const undid = s.future[0] !== undefined && s.future[0] === prev.past[prev.past.length - 1]
  const redid = s.past[depth - 1] !== undefined && s.past[depth - 1] === prev.future[0]
  if (undid) {
    const gone = recording.steps.filter((x) => x.depth !== null && x.depth > depth)
    if (!gone.length) return
    undone = [...gone, ...undone]
    useMacros.setState({ recording: { ...recording, steps: recording.steps.filter((x) => !gone.includes(x)) } })
  } else if (redid && undone.length) {
    const back = undone.filter((x) => x.depth !== null && x.depth <= depth)
    if (!back.length) return
    undone = undone.filter((x) => !back.includes(x))
    useMacros.setState({ recording: { ...recording, steps: [...recording.steps, ...back] } })
  }
})

export interface MacroRun {
  /** Clips the macro ran on from start to finish. */
  done: number
  /** Clips it couldn't be done to — left exactly as they were — and the step that stopped it. */
  failed: { clipId: string; name: string; why: string }[]
}

/**
 * Runs a macro on clips, one after another, as one undo step. A clip a step
 * can't be done to is put back as it was (the others still get the macro).
 */
export function runMacro(macro: Macro, clipIds: readonly string[], source: 'user' | 'ai' = 'user'): MacroRun {
  const order = new Map(getProject().tracks.map((t, i) => [t.id, i]))
  const targets = clipIds
    .map((id) => getProject().clips[id])
    .filter(Boolean)
    .sort((a, b) => a.start - b.start || (order.get(a.trackId) ?? 0) - (order.get(b.trackId) ?? 0))
    .map((c) => ({ id: c.id, name: c.name }))
  const run: MacroRun = { done: 0, failed: [] }
  // Recorded at another frame rate, its lengths are worth the same time here.
  const scale = macro.fps ? getProject().settings.fps / macro.fps : 1
  const opened = beginTransaction(`Macro: ${macro.name}`, source)
  replaying = true
  try {
    for (const target of targets) {
      if (!getProject().clips[target.id]) {
        run.failed.push({ clipId: target.id, name: target.name, why: 'an earlier run of the macro removed it' })
        continue
      }
      const mark = savepoint()
      const ctx = { clipId: target.id, results: [] as unknown[], made: [] as string[][] }
      let why: string | undefined
      for (const [n, step] of macro.steps.entries()) {
        try {
          const was = getProject()
          const res = dispatch(step.command, instantiate(step, was, ctx, scale) as never, { label: step.title, source })
          if (!res.ok) {
            why = `step ${n + 1} (${step.title}): ${res.error}`
            break
          }
          ctx.results.push(res.result)
          ctx.made.push(madeBy(was, getProject()))
        } catch (err) {
          if (!(err instanceof MacroError)) throw err
          why = `step ${n + 1} (${step.title}): ${err.message}`
          break
        }
      }
      if (!why) run.done++
      else {
        if (mark) rollbackTo(mark)
        run.failed.push({ clipId: target.id, name: target.name, why })
      }
    }
  } finally {
    replaying = false
    if (opened) endTransaction()
  }
  if (run.done) useMacros.setState({ lastId: macro.id })
  return run
}