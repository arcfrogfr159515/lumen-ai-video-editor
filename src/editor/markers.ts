/**
 * Markers by kind — chapters, to-dos and comments: what each is for, filtering
 * them, the sections chapters divide the film into, and the lists they export as.
 */
import { formatTimecode } from '@/lib/time'
import { projectDuration } from './ops'
import type { Frame, Marker, MarkerColor, MarkerKind, Project } from './types'

/** A marker's kind as the filter and the lists name it: plain markers have none. */
export type MarkerFilter = MarkerKind | 'plain'

export const MARKER_KINDS: { id: MarkerFilter; label: string; plural: string; hint: string; color: MarkerColor }[] = [
  { id: 'chapter', label: 'Chapter', plural: 'Chapters', hint: 'Starts a section of the film, and names it in a chapter list', color: 'sky' },
  { id: 'todo', label: 'To-do', plural: 'To-dos', hint: 'Something still to fix here — tick it off when it’s done', color: 'amber' },
  { id: 'comment', label: 'Comment', plural: 'Comments', hint: 'A remark for whoever reads the timeline next', color: 'violet' },
  { id: 'plain', label: 'Marker', plural: 'Markers', hint: 'A place to come back to', color: 'lime' },
]

export const markerKindOf = (m: Pick<Marker, 'kind'>): MarkerFilter => m.kind ?? 'plain'

export const markerKindInfo = (kind: MarkerFilter) => MARKER_KINDS.find((k) => k.id === kind) ?? MARKER_KINDS[3]

/** The label a new marker of a kind gets when none is given. */
export function defaultMarkerLabel(markers: readonly Marker[], kind: MarkerFilter) {
  const n = markers.filter((m) => markerKindOf(m) === kind).length + 1
  return kind === 'chapter' ? `Chapter ${n}` : kind === 'todo' ? `To-do ${n}` : kind === 'comment' ? `Comment ${n}` : `Marker ${markers.length + 1}`
}

export interface MarkerQuery {
  /** The kinds to keep (missing or empty: all of them). */
  kinds?: readonly MarkerFilter[]
  /** Leave out to-dos that are ticked off. */
  hideDone?: boolean
  /** Keep markers whose label or note contains this, ignoring case. */
  text?: string
  /** Only markers in [from, to). */
  from?: Frame
  to?: Frame
}

export function filterMarkers<M extends Marker>(markers: readonly M[], q: MarkerQuery = {}): M[] {
  const kinds = q.kinds?.length ? new Set(q.kinds) : null
  const needle = q.text?.trim().toLowerCase()
  return markers.filter((m) => {
    if (kinds && !kinds.has(markerKindOf(m))) return false
    if (q.hideDone && m.kind === 'todo' && m.done) return false
    if (q.from !== undefined && m.frame < q.from) return false
    if (q.to !== undefined && m.frame >= q.to) return false
    if (needle && !`${m.label}\n${m.note ?? ''}`.toLowerCase().includes(needle)) return false
    return true
  })
}

/** How many markers there are of each kind, and how many to-dos are still open. */
export function markerCounts(markers: readonly Marker[]) {
  const counts: Record<MarkerFilter, number> & { open: number } = { chapter: 0, todo: 0, comment: 0, plain: 0, open: 0 }
  for (const m of markers) {
    counts[markerKindOf(m)]++
    if (m.kind === 'todo' && !m.done) counts.open++
  }
  return counts
}

// ─── Chapters ────────────────────────────────────────────────────────────

export interface Chapter {
  /** The chapter marker that starts it; missing for the stretch before the first chapter. */
  markerId?: string
  title: string
  start: Frame
  /** Exclusive: the next chapter's start, or the end of the timeline. */
  end: Frame
}

/**
 * The sections chapter markers divide the timeline into, in order. Whatever
 * plays before the first chapter is a section of its own (`opening`), so the
 * sections always cover the whole timeline. Empty when there are no chapters.
 */
export function chapters(project: Pick<Project, 'markers' | 'clips'>, opening = 'Opening'): Chapter[] {
  const marks = project.markers.filter((m) => m.kind === 'chapter').sort((a, b) => a.frame - b.frame)
  if (!marks.length) return []
  const end = Math.max(projectDuration(project), marks[marks.length - 1].frame + 1)
  const out: Chapter[] = []
  if (marks[0].frame > 0) out.push({ title: opening, start: 0, end: marks[0].frame })
  marks.forEach((m, i) => {
    const next = marks[i + 1]?.frame ?? end
    // Two chapters on one frame: the later one names the section.
    if (next > m.frame) out.push({ markerId: m.id, title: m.label, start: m.frame, end: next })
  })
  return out
}

/** The chapter a frame is in, if the timeline has chapters. */
export function chapterAt(list: readonly Chapter[], frame: Frame) {
  return list.find((c) => frame >= c.start && frame < c.end)
}

// ─── Export ──────────────────────────────────────────────────────────────

export type MarkerExportFormat = 'youtube' | 'markdown' | 'csv' | 'json'

export const MARKER_EXPORTS: Record<MarkerExportFormat, { label: string; extension: string; hint: string; mime: string }> = {
  youtube: { label: 'YouTube chapters', extension: 'txt', hint: 'A chapter list to paste into a video description', mime: 'text/plain' },
  markdown: { label: 'Markdown', extension: 'md', hint: 'Chapters, a to-do checklist and comments, to read or share', mime: 'text/markdown' },
  csv: { label: 'CSV', extension: 'csv', hint: 'One row per marker, for a spreadsheet', mime: 'text/csv' },
  json: { label: 'JSON', extension: 'json', hint: 'Everything, for another tool to read', mime: 'application/json' },
}

/** 0:00, 12:05 or 1:02:03 — how video sites write chapter times. */
export function clockTime(frame: Frame, fps: number, hours = false) {
  const total = Math.floor(frame / fps + 1e-6)
  const h = Math.floor(total / 3600)
  const m = Math.floor(total / 60) % 60
  const s = String(total % 60).padStart(2, '0')
  return h > 0 || hours ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

const csvCell = (v: string | number | boolean) => {
  const s = String(v)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export interface MarkerExport {
  text: string
  /** How many markers went into it. */
  count: number
  /** What a reader should know: a chapter list a video site would refuse, and why. */
  warnings: string[]
}

/**
 * Markers as text. `youtube` lists the chapters only (the stretch before the
 * first chapter becomes “Intro”, since a chapter list has to start at 0:00);
 * the other formats take every marker that passes `query`.
 */
export function exportMarkers(project: Pick<Project, 'markers' | 'clips' | 'settings' | 'name'>, format: MarkerExportFormat, query: MarkerQuery = {}): MarkerExport {
  const fps = project.settings.fps
  const warnings: string[] = []
  if (format === 'youtube') {
    const list = chapters(project, 'Intro')
    if (!list.length) return { text: '', count: 0, warnings: ['There are no chapter markers yet.'] }
    const long = list[list.length - 1].start >= 3600 * fps
    if (list.length < 3) warnings.push('YouTube needs at least three chapters.')
    const short = list.filter((c) => c.end - c.start < 10 * fps)
    if (short.length) warnings.push(`${short.length === 1 ? `“${short[0].title}” is` : `${short.length} chapters are`} shorter than 10 seconds, which YouTube doesn’t accept.`)
    return { text: list.map((c) => `${clockTime(c.start, fps, long)} ${c.title}`).join('\n') + '\n', count: list.length, warnings }
  }
  const marks = filterMarkers(project.markers, query).sort((a, b) => a.frame - b.frame)
  const tc = (m: Marker) => formatTimecode(m.frame, fps)
  if (format === 'json') {
    const rows = marks.map((m) => ({
      timecode: tc(m),
      seconds: Math.round((m.frame / fps) * 1000) / 1000,
      frame: m.frame,
      kind: markerKindOf(m),
      label: m.label,
      ...(m.note ? { note: m.note } : {}),
      ...(m.kind === 'todo' ? { done: Boolean(m.done) } : {}),
      color: m.color,
    }))
    return { text: JSON.stringify({ project: project.name, fps, markers: rows }, null, 2) + '\n', count: marks.length, warnings }
  }
  if (format === 'csv') {
    const rows = [['Timecode', 'Seconds', 'Kind', 'Label', 'Note', 'Done', 'Color'], ...marks.map((m) => [tc(m), (m.frame / fps).toFixed(3), markerKindOf(m), m.label, m.note ?? '', m.kind === 'todo' ? (m.done ? 'yes' : 'no') : '', m.color])]
    // A byte-order mark, so spreadsheets read the accents.
    return { text: '\uFEFF' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n', count: marks.length, warnings }
  }
  const lines: string[] = [`# ${project.name} — markers`, '']
  const note = (m: Marker) => (m.note ? ` — ${m.note.replace(/\s*\n\s*/g, ' ')}` : '')
  for (const kind of MARKER_KINDS) {
    const group = marks.filter((m) => markerKindOf(m) === kind.id)
    if (!group.length) continue
    lines.push(`## ${kind.plural}`, '')
    for (const m of group) lines.push(kind.id === 'todo' ? `- [${m.done ? 'x' : ' '}] \`${tc(m)}\` ${m.label}${note(m)}` : `- \`${tc(m)}\` ${m.label}${note(m)}`)
    lines.push('')
  }
  return { text: lines.join('\n'), count: marks.length, warnings }
}
