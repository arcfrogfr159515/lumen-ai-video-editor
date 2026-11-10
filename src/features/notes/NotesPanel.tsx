/**
 * Markers and clip notes in one place: chapters, to-dos and comments with a
 * filter and their exports, and every note and task list left on a clip.
 */
import { BookMarked, Check, ClipboardCopy, Download, Ellipsis, Flag, ListChecks, MessageSquare, Plus, SquareCheck, StickyNote, Trash } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Button, IconButton } from '@/components/ui/button'
import { SearchInput } from '@/components/ui/input'
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from '@/components/ui/menu'
import { Segmented } from '@/components/ui/segmented'
import { Switch } from '@/components/ui/switch'
import { exportMarkers, filterMarkers, MARKER_EXPORTS, MARKER_KINDS, markerCounts, markerKindOf, type MarkerExportFormat, type MarkerFilter } from '@/editor/markers'
import { clipNotes, notesMarkdown, taskCounts, toggleTask } from '@/editor/notes'
import { playback, usePlayback } from '@/editor/playback'
import { dispatch, getProject, useEditor } from '@/editor/store'
import type { Marker, MarkerKind } from '@/editor/types'
import { useUI } from '@/editor/ui-store'
import { MARKER_COLORS } from '@/features/timeline/Ruler'
import { useTimelineView } from '@/editor/timeline-view'
import { cn } from '@/lib/cn'
import { formatTimecode } from '@/lib/time'
import { copyText, saveTextFile } from '@/project/text-files'

export const MARKER_ICON: Record<MarkerFilter, typeof Flag> = { chapter: BookMarked, todo: SquareCheck, comment: MessageSquare, plain: Flag }

type View = 'markers' | 'clips'

export function NotesPanel() {
  const [view, setView] = useState<View>('markers')
  const open = useEditor((s) => markerCounts(s.project.markers).open)
  const tasks = useEditor((s) => taskCounts(s.project).open)
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 px-3 pt-3 pb-2">
        <Segmented
          stretch
          className="flex-1"
          value={view}
          onChange={setView}
          options={[
            { value: 'markers', label: <Counted label="Markers" count={open} title="open to-dos" /> },
            { value: 'clips', label: <Counted label="Clip notes" count={tasks} title="open tasks" /> },
          ]}
        />
      </div>
      {view === 'markers' ? <MarkerList /> : <ClipNoteList />}
    </div>
  )
}

function Counted({ label, count, title }: { label: string; count: number; title: string }) {
  return (
    <span className="flex items-center gap-1.5">
      {label}
      {count > 0 && (
        <span title={`${count} ${title}`} className="rounded-full bg-warn/20 px-1.5 text-[10px] leading-4 font-semibold text-warn tabular">
          {count}
        </span>
      )}
    </span>
  )
}

function Empty({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
      <span className="grid size-10 place-items-center rounded-xl bg-white/[0.04] text-fg-3 [&_svg]:size-5">{icon}</span>
      <div className="text-sm font-medium text-fg-2">{title}</div>
      <p className="text-xs leading-relaxed text-fg-4">{children}</p>
    </div>
  )
}

// ─── Markers ─────────────────────────────────────────────────────────────

function MarkerList() {
  const markers = useEditor((s) => s.project.markers)
  const fps = useEditor((s) => s.project.settings.fps)
  const kinds = useTimelineView((s) => s.markerKinds)
  const hideDone = useTimelineView((s) => s.hideDone)
  const toggleKind = useTimelineView((s) => s.toggleMarkerKind)
  const setView = useTimelineView((s) => s.set)
  const [query, setQuery] = useState('')
  const counts = useMemo(() => markerCounts(markers), [markers])
  const shown = useMemo(() => filterMarkers(markers, { kinds, hideDone, text: query }), [markers, kinds, hideDone, query])

  const addAt = (kind: MarkerFilter) => {
    const res = dispatch('marker.add', { frame: usePlayback.getState().frame, ...(kind === 'plain' ? {} : { kind }) })
    if (!res.ok) toast(res.error)
  }

  return (
    <>
      <div className="shrink-0 space-y-2 px-3 pb-2">
        <SearchInput value={query} onChange={setQuery} placeholder="Search markers" aria-label="Search markers" />
        <div className="flex flex-wrap items-center gap-1">
          {MARKER_KINDS.map((k) => {
            const Icon = MARKER_ICON[k.id]
            const on = kinds.length === 0 || kinds.includes(k.id)
            return (
              <button
                key={k.id}
                type="button"
                aria-pressed={kinds.includes(k.id)}
                title={`${k.hint}${kinds.includes(k.id) ? ' — showing only the kinds picked' : ''}`}
                onClick={() => toggleKind(k.id)}
                className={cn(
                  'flex h-6 items-center gap-1 rounded-full px-2 text-2xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/60',
                  kinds.includes(k.id) ? 'bg-white/[0.12] text-fg shadow-[inset_0_0_0_1px_rgb(255_255_255/0.16)]' : on ? 'bg-white/[0.04] text-fg-2 hover:bg-white/[0.08]' : 'bg-white/[0.02] text-fg-4 hover:text-fg-3',
                )}
              >
                <Icon className="size-3" style={{ color: on ? MARKER_COLORS[k.color] : undefined }} />
                {k.plural}
                <span className="text-fg-4 tabular">{counts[k.id]}</span>
              </button>
            )
          })}
        </div>
        <div className="flex items-center gap-2 text-2xs text-fg-3">
          <Switch checked={hideDone} onChange={(v) => setView({ hideDone: v })} aria-label="Hide finished to-dos" />
          Hide finished to-dos
          <div className="ml-auto flex items-center gap-1">
            <Menu>
              <MenuTrigger asChild>
                <Button size="xs" variant="secondary">
                  <Plus /> Add
                </Button>
              </MenuTrigger>
              <MenuContent align="end">
                <MenuLabel>At the playhead</MenuLabel>
                {MARKER_KINDS.map((k) => {
                  const Icon = MARKER_ICON[k.id]
                  return (
                    <MenuItem key={k.id} icon={<Icon />} shortcut={k.id === 'plain' ? 'm' : undefined} onSelect={() => addAt(k.id)}>
                      {k.label}
                    </MenuItem>
                  )
                })}
              </MenuContent>
            </Menu>
            <ExportMenu />
          </div>
        </div>
      </div>
      {markers.length === 0 ? (
        <Empty icon={<Flag />} title="No markers yet">
          Press M to drop one at the playhead. Chapters divide the film into sections, to-dos keep track of what’s left to fix, comments are for whoever reads the timeline next.
        </Empty>
      ) : shown.length === 0 ? (
        <Empty icon={<Flag />} title="Nothing matches">
          {markers.length} marker{markers.length === 1 ? '' : 's'} hidden by the filter.
        </Empty>
      ) : (
        <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-3">
          {shown.map((m) => (
            <MarkerRow key={m.id} marker={m} fps={fps} />
          ))}
        </ul>
      )}
    </>
  )
}

function MarkerRow({ marker, fps }: { marker: Marker; fps: number }) {
  const kind = markerKindOf(marker)
  const Icon = MARKER_ICON[kind]
  const [label, setLabel] = useState(marker.label)
  const [note, setNote] = useState(marker.note ?? '')
  const [open, setOpen] = useState(false)
  useEffect(() => setLabel(marker.label), [marker.label])
  useEffect(() => setNote(marker.note ?? ''), [marker.note])
  const patch = (p: { label?: string; note?: string | null; kind?: MarkerKind | null; done?: boolean }) => {
    const res = dispatch('marker.update', { id: marker.id, patch: p })
    if (!res.ok) toast(res.error)
  }
  const done = marker.kind === 'todo' && marker.done

  return (
    <li className={cn('group/row rounded-lg bg-white/[0.03] px-2 py-1.5 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.04)] transition-colors hover:bg-white/[0.05]', done && 'opacity-60')}>
      <div className="flex items-center gap-2">
        {marker.kind === 'todo' ? (
          <button
            type="button"
            role="checkbox"
            aria-checked={Boolean(marker.done)}
            aria-label={marker.done ? 'Reopen' : 'Tick off'}
            onClick={() => patch({ done: !marker.done })}
            className={cn('grid size-4 shrink-0 place-items-center rounded-[5px] outline-none ring-1 ring-inset transition-colors focus-visible:ring-2 focus-visible:ring-accent/60', marker.done ? 'bg-ok text-black ring-ok' : 'ring-warn/70 hover:bg-warn/15')}
          >
            {marker.done && <Check className="size-3" strokeWidth={3} />}
          </button>
        ) : (
          <Icon className="size-3.5 shrink-0" style={{ color: MARKER_COLORS[marker.color] }} />
        )}
        <button
          type="button"
          title="Go to this marker"
          onClick={() => (playback.pause(), playback.seek(marker.frame))}
          className="shrink-0 rounded px-1 font-mono text-2xs text-fg-3 tabular outline-none hover:bg-white/[0.07] hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          {formatTimecode(marker.frame, fps)}
        </button>
        <input
          value={label}
          aria-label="Marker label"
          onChange={(e) => setLabel(e.target.value)}
          onBlur={() => (label.trim() && label.trim() !== marker.label ? patch({ label: label.trim() }) : setLabel(marker.label))}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') (setLabel(marker.label), e.currentTarget.blur())
          }}
          className={cn('min-w-0 flex-1 truncate rounded bg-transparent px-1 py-0.5 text-sm text-fg outline-none hover:bg-white/[0.04] focus:bg-white/[0.07] focus:ring-1 focus:ring-accent/60', done && 'line-through')}
        />
        <Menu>
          <MenuTrigger asChild>
            <IconButton size="xs" label="Marker options" className="opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100">
              <Ellipsis />
            </IconButton>
          </MenuTrigger>
          <MenuContent align="end">
            <MenuLabel>This marker is a</MenuLabel>
            {MARKER_KINDS.map((k) => {
              const KindIcon = MARKER_ICON[k.id]
              return (
                <MenuItem key={k.id} icon={<KindIcon />} checked={kind === k.id} onSelect={() => patch({ kind: k.id === 'plain' ? null : k.id })}>
                  {k.label}
                </MenuItem>
              )
            })}
            <MenuSeparator />
            <MenuItem icon={<StickyNote />} onSelect={() => setOpen(true)}>
              {marker.note ? 'Edit note' : 'Add a note'}
            </MenuItem>
            <MenuItem icon={<Trash />} danger onSelect={() => dispatch('marker.remove', { id: marker.id })}>
              Remove marker
            </MenuItem>
          </MenuContent>
        </Menu>
      </div>
      {(open || marker.note) && (
        <textarea
          value={note}
          rows={Math.min(5, Math.max(1, note.split('\n').length))}
          placeholder="Note…"
          aria-label="Marker note"
          autoFocus={open && !marker.note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => {
            if (note.trim() !== (marker.note ?? '')) patch({ note: note.trim() || null })
            setOpen(false)
          }}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Escape') (setNote(marker.note ?? ''), e.currentTarget.blur())
          }}
          className="mt-1 ml-6 block w-[calc(100%-1.5rem)] resize-none rounded bg-transparent px-1 py-0.5 text-xs leading-relaxed text-fg-3 outline-none placeholder:text-fg-4 hover:bg-white/[0.04] focus:bg-white/[0.07] focus:text-fg-2 focus:ring-1 focus:ring-accent/60"
        />
      )}
    </li>
  )
}

function ExportMenu() {
  const kinds = useTimelineView((s) => s.markerKinds)
  const hideDone = useTimelineView((s) => s.hideDone)
  const build = (format: MarkerExportFormat) => {
    const out = exportMarkers(getProject(), format, { kinds, hideDone })
    if (!out.count) {
      toast(format === 'youtube' ? 'No chapters to export' : 'No markers to export', { description: out.warnings[0] ?? 'Nothing passes the filter.' })
      return null
    }
    return out
  }
  const save = async (format: MarkerExportFormat) => {
    const out = build(format)
    if (!out) return
    const info = MARKER_EXPORTS[format]
    try {
      await saveTextFile(
        { name: `${getProject().name} ${format === 'youtube' ? 'chapters' : 'markers'}`, extension: info.extension, filterName: info.label, mime: info.mime, text: out.text },
        `Saved ${out.count} ${format === 'youtube' ? 'chapter' : 'marker'}${out.count === 1 ? '' : 's'}`,
      )
      if (out.warnings.length) toast(out.warnings.join(' '))
    } catch (err) {
      toast.error('Couldn’t save the file', { description: err instanceof Error ? err.message : String(err) })
    }
  }
  const copyChapters = async () => {
    const out = build('youtube')
    if (!out) return
    if (await copyText(out.text, `Copied ${out.count} chapters`)) if (out.warnings.length) toast(out.warnings.join(' '))
  }
  return (
    <Menu>
      <MenuTrigger asChild>
        <Button size="xs" variant="secondary">
          <Download /> Export
        </Button>
      </MenuTrigger>
      <MenuContent align="end" className="min-w-[250px]">
        <MenuItem icon={<ClipboardCopy />} onSelect={() => void copyChapters()}>
          Copy chapter list
        </MenuItem>
        <MenuSeparator />
        <MenuLabel>Save as a file</MenuLabel>
        {(Object.keys(MARKER_EXPORTS) as MarkerExportFormat[]).map((f) => (
          <MenuItem key={f} icon={<Download />} onSelect={() => void save(f)}>
            <span title={MARKER_EXPORTS[f].hint}>{MARKER_EXPORTS[f].label}</span>
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  )
}

// ─── Clip notes ──────────────────────────────────────────────────────────

function ClipNoteList() {
  const clips = useEditor((s) => s.project.clips)
  const tracks = useEditor((s) => s.project.tracks)
  const fps = useEditor((s) => s.project.settings.fps)
  const selection = useUI((s) => s.selection)
  const showNotes = useTimelineView((s) => s.showNotes)
  const setView = useTimelineView((s) => s.set)
  const [query, setQuery] = useState('')
  const [openOnly, setOpenOnly] = useState(false)
  const all = useMemo(() => clipNotes({ clips, tracks }), [clips, tracks])
  const rows = useMemo(() => clipNotes({ clips, tracks }, { text: query, openOnly }), [clips, tracks, query, openOnly])

  const go = (clipId: string, start: number) => {
    useUI.getState().select([clipId])
    useUI.getState().setRightTab('inspector')
    playback.pause()
    playback.seek(start)
  }
  const save = async () => {
    try {
      await saveTextFile({ name: `${getProject().name} clip notes`, extension: 'md', filterName: 'Markdown', mime: 'text/markdown', text: notesMarkdown(getProject()) }, 'Saved the clip notes')
    } catch (err) {
      toast.error('Couldn’t save the file', { description: err instanceof Error ? err.message : String(err) })
    }
  }

  return (
    <>
      <div className="shrink-0 space-y-2 px-3 pb-2">
        <SearchInput value={query} onChange={setQuery} placeholder="Search notes and tasks" aria-label="Search notes and tasks" />
        <div className="flex items-center gap-2 text-2xs text-fg-3">
          <Switch checked={openOnly} onChange={setOpenOnly} aria-label="Only clips with open tasks" />
          Open tasks only
          <span className="mx-1 h-3 w-px bg-line-2" />
          <Switch checked={showNotes} onChange={(v) => setView({ showNotes: v })} aria-label="Show notes on clips" />
          On clips
          <Button size="xs" variant="secondary" className="ml-auto" disabled={!all.length} onClick={() => void save()}>
            <Download /> Export
          </Button>
        </div>
      </div>
      {all.length === 0 ? (
        <Empty icon={<ListChecks />} title="No clip notes yet">
          Select a clip and open Notes &amp; tasks in the inspector to leave a remark or a to-do list on it. They travel with the clip and are saved with the project.
        </Empty>
      ) : rows.length === 0 ? (
        <Empty icon={<ListChecks />} title="Nothing matches">
          {all.length} clip{all.length === 1 ? '' : 's'} with notes hidden by the filter.
        </Empty>
      ) : (
        <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-3">
          {rows.map((row) => (
            <li
              key={row.clipId}
              className={cn(
                'rounded-lg bg-white/[0.03] px-2.5 py-2 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.04)] transition-colors hover:bg-white/[0.05]',
                selection.includes(row.clipId) && 'shadow-[inset_0_0_0_1px_rgb(214_238_0/0.45)]',
              )}
            >
              <button type="button" onClick={() => go(row.clipId, row.start)} title="Select this clip and go to it" className="flex w-full min-w-0 items-baseline gap-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">{row.name}</span>
                <span className="shrink-0 text-2xs text-fg-4">{row.trackName}</span>
                <span className="shrink-0 font-mono text-2xs text-fg-3 tabular">{formatTimecode(row.start, fps)}</span>
              </button>
              {row.note && <p className="mt-1 text-xs leading-relaxed whitespace-pre-wrap text-fg-3">{row.note}</p>}
              {row.tasks.length > 0 && (
                <ul className="mt-1.5 space-y-1">
                  {row.tasks.map((t) => (
                    <li key={t.id}>
                      <label className="flex cursor-pointer items-start gap-2 text-xs text-fg-2">
                        <input
                          type="checkbox"
                          checked={t.done}
                          onChange={() => dispatch('clip.update', { ids: [row.clipId], patch: { tasks: toggleTask(row.tasks, t.id) } }, { label: t.done ? 'Reopen task' : 'Tick off task' })}
                          className="mt-0.5 size-3.5 shrink-0 accent-[var(--color-accent)]"
                        />
                        <span className={cn('min-w-0 flex-1', t.done && 'text-fg-4 line-through')}>{t.text}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
