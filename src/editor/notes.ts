/**
 * Notes and task lists on clips. They live on the clip (so they follow it
 * through moves, copies and undo, and are saved with the project); this is
 * what reads them back as one list for the whole timeline.
 */
import { uid } from '@/lib/id'
import { formatTimecode } from '@/lib/time'
import type { Clip, ClipTask, Frame, Project } from './types'
import { tt } from '@/lib/i18n'

export interface ClipNoteRow {
  clipId: string
  name: string
  trackId: string
  trackName: string
  start: Frame
  note?: string
  tasks: ClipTask[]
  /** Tasks not done yet. */
  open: number
}

export const hasNotes = (clip: Pick<Clip, 'note' | 'tasks'>) => Boolean(clip.note || clip.tasks?.length)

export const openTasks = (clip: Pick<Clip, 'tasks'>) => clip.tasks?.filter((t) => !t.done).length ?? 0

/** Every clip with a note or tasks, in timeline order. */
export function clipNotes(project: Pick<Project, 'clips' | 'tracks'>, q: { text?: string; openOnly?: boolean } = {}): ClipNoteRow[] {
  const order = new Map(project.tracks.map((t, i) => [t.id, i]))
  const names = new Map(project.tracks.map((t) => [t.id, t.name]))
  const needle = q.text?.trim().toLowerCase()
  return Object.values(project.clips)
    .filter(hasNotes)
    .map((c) => ({ clipId: c.id, name: c.name, trackId: c.trackId, trackName: names.get(c.trackId) ?? '', start: c.start, note: c.note, tasks: c.tasks ?? [], open: openTasks(c) }))
    .filter((row) => {
      if (q.openOnly && !row.open) return false
      if (!needle) return true
      return [row.name, row.note ?? '', ...row.tasks.map((t) => t.text)].some((s) => s.toLowerCase().includes(needle))
    })
    .sort((a, b) => a.start - b.start || (order.get(a.trackId) ?? 0) - (order.get(b.trackId) ?? 0))
}

export function taskCounts(project: Pick<Project, 'clips'>) {
  let clips = 0
  let tasks = 0
  let open = 0
  for (const c of Object.values(project.clips)) {
    if (!hasNotes(c)) continue
    clips++
    tasks += c.tasks?.length ?? 0
    open += openTasks(c)
  }
  return { clips, tasks, open }
}

// The list on a clip is replaced whole (clip_update → tasks), so each change is one undo step.

export const addTask = (tasks: readonly ClipTask[] | undefined, text: string): ClipTask[] => [...(tasks ?? []), { id: uid('task'), text: text.trim(), done: false }]

export const toggleTask = (tasks: readonly ClipTask[] | undefined, id: string): ClipTask[] => (tasks ?? []).map((t) => (t.id === id ? { ...t, done: !t.done } : t))

export const removeTask = (tasks: readonly ClipTask[] | undefined, id: string): ClipTask[] => (tasks ?? []).filter((t) => t.id !== id)

export const renameTask = (tasks: readonly ClipTask[] | undefined, id: string, text: string): ClipTask[] => (tasks ?? []).map((t) => (t.id === id ? { ...t, text: text.trim() } : t))

/** The timeline's notes and tasks as a checklist to read or hand over. */
export function notesMarkdown(project: Pick<Project, 'clips' | 'tracks' | 'settings' | 'name'>): string {
  const rows = clipNotes(project)
  const lines = [tt('# {0} — clip notes', project.name), '']
  for (const row of rows) {
    lines.push(`## \`${formatTimecode(row.start, project.settings.fps)}\` ${row.name} (${row.trackName})`, '')
    if (row.note) lines.push(row.note, '')
    for (const t of row.tasks) lines.push(`- [${t.done ? 'x' : ' '}] ${t.text}`)
    if (row.tasks.length) lines.push('')
  }
  if (!rows.length) lines.push(tt('No notes yet.'), '')
  return lines.join('\n')
}
