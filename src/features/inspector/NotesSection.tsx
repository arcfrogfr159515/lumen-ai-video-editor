/**
 * What is written on a clip rather than done to it: a colour label, who is
 * speaking, a note and a list of things still to do.
 */
import { Plus, StickyNote, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Row, Section } from '@/components/ui/section'
import { LABEL_COLORS, clipTint, speakerOf } from '@/editor/clip-colors'
import { addTask, openTasks, removeTask, renameTask, toggleTask } from '@/editor/notes'
import { dispatch, useEditor } from '@/editor/store'
import type { Clip, ClipTask, LabelColor } from '@/editor/types'
import { cn } from '@/lib/cn'
import { tt } from '@/lib/i18n'
import { ttx } from '@/lib/i18n-react'

type NotePatch = { label?: LabelColor | null; speaker?: string | null; note?: string | null; tasks?: ClipTask[] | null }

/** The label swatches: the clip's own label is ringed, the colour a rule gives it is dotted. */
export function LabelSwatches({ value, hint, onChange }: { value: LabelColor | undefined; hint?: LabelColor; onChange: (color: LabelColor | null) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        aria-label={tt('No label')}
        title={tt('No label — coloured by the project’s rules')}
        onClick={() => onChange(null)}
        className={cn('grid size-5 place-items-center rounded-full text-fg-4 ring-1 ring-ink/15 transition-transform hover:scale-110 hover:text-fg-2', !value && 'ring-2 ring-accent ring-offset-2 ring-offset-surface')}
      >
        <X className="size-3" />
      </button>
      {LABEL_COLORS.map((c) => (
        <button
          key={c.id}
          type="button"
          aria-label={c.name}
          aria-pressed={value === c.id}
          title={hint === c.id && value !== c.id ? tt('{0} — what the colour rules give it now', c.name) : c.name}
          onClick={() => onChange(value === c.id ? null : c.id)}
          className={cn('relative size-5 rounded-full ring-1 ring-ink/15 transition-transform hover:scale-110', value === c.id && 'ring-2 ring-accent ring-offset-2 ring-offset-surface')}
          style={{ background: c.css }}
        >
          {hint === c.id && value !== c.id && <span className="absolute inset-0 m-auto size-1.5 rounded-full bg-shade/60" />}
        </button>
      ))}
    </div>
  )
}

export function NotesSection({ clips }: { clips: Clip[] }) {
  const clip = clips[0]
  const single = clips.length === 1
  const ids = clips.map((c) => c.id)
  const ruleColor = useEditor((s) => (single && !clip.label ? clipTint(s.project, clip)?.color : undefined))
  const heard = useEditor((s) => (single ? speakerOf(s.project, clip) : undefined))
  const sameLabel = clips.every((c) => c.label === clip.label) ? clip.label : undefined
  const sameSpeaker = clips.every((c) => (c.speaker ?? '') === (clip.speaker ?? '')) ? (clip.speaker ?? '') : ''
  const [speaker, setSpeaker] = useState(sameSpeaker)
  const [note, setNote] = useState(clip.note ?? '')
  const [draft, setDraft] = useState('')
  useEffect(() => setSpeaker(sameSpeaker), [sameSpeaker])
  useEffect(() => setNote(clip.note ?? ''), [clip.note])

  const update = (patch: NotePatch, label?: string, targets = ids) => {
    const res = dispatch('clip.update', { ids: targets, patch }, label ? { label } : undefined)
    if (!res.ok) toast(res.error)
  }
  const open = single ? openTasks(clip) : 0
  const tasks = clip.tasks ?? []

  return (
    <Section
      title={single && (clip.note || tasks.length) ? tt('Notes & tasks{0}', open ? (' ' + tt('· {0} open', open)) : '') : tt('Notes & tasks')}
      icon={<StickyNote />}
      defaultOpen={Boolean(clip.note || tasks.length || clip.label || clip.speaker)}
    >
      <div className="space-y-2.5">
        <Row label={tt('Label')}>
          <LabelSwatches value={sameLabel} hint={ruleColor} onChange={(color) => update({ label: color }, color ? tt('Label clip') : tt('Remove label'))} />
        </Row>
        <Row label={tt('Speaker')}>
          <input
            value={speaker}
            placeholder={heard && !clip.speaker ? tt('{0} (from the media)', heard) : tt('Who is talking')}
            aria-label={tt('Speaker')}
            onChange={(e) => setSpeaker(e.target.value)}
            onBlur={() => speaker.trim() !== sameSpeaker && update({ speaker: speaker.trim() || null }, tt('Set speaker'))}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter') e.currentTarget.blur()
            }}
            className="h-7 w-full rounded-md bg-ink/[0.05] px-2 text-sm text-fg outline-none placeholder:text-fg-4 focus:ring-1 focus:ring-accent/60"
          />
        </Row>
        {single ? (
          <>
            <textarea
              value={note}
              rows={Math.min(8, Math.max(2, note.split('\n').length))}
              placeholder={tt('A note about this clip…')}
              aria-label={tt('Clip note')}
              onChange={(e) => setNote(e.target.value)}
              onBlur={() => note.trim() !== (clip.note ?? '') && update({ note: note.trim() || null }, note.trim() ? tt('Edit note') : tt('Remove note'))}
              onKeyDown={(e) => e.stopPropagation()}
              className="block w-full resize-none rounded-md bg-ink/[0.05] px-2 py-1.5 text-sm leading-relaxed text-fg outline-none placeholder:text-fg-4 focus:ring-1 focus:ring-accent/60"
            />
            <ul className="space-y-1">
              {tasks.map((t) => (
                <TaskRow
                  key={t.id}
                  task={t}
                  onToggle={() => update({ tasks: toggleTask(tasks, t.id) }, t.done ? tt('Reopen task') : tt('Tick off task'))}
                  onRename={(text) => update({ tasks: text ? renameTask(tasks, t.id, text) : removeTask(tasks, t.id) }, text ? tt('Edit task') : tt('Remove task'))}
                  onRemove={() => update({ tasks: removeTask(tasks, t.id) }, tt('Remove task'))}
                />
              ))}
            </ul>
            <form
              className="flex items-center gap-1.5"
              onSubmit={(e) => {
                e.preventDefault()
                if (!draft.trim()) return
                update({ tasks: addTask(tasks, draft) }, tt('Add task'))
                setDraft('')
              }}
            >
              <Plus className="size-3.5 shrink-0 text-fg-4" />
              <input
                value={draft}
                placeholder={tt('Add a task and press Enter')}
                aria-label={tt('New task')}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
                className="h-7 min-w-0 flex-1 rounded-md bg-transparent px-1.5 text-sm text-fg outline-none placeholder:text-fg-4 hover:bg-ink/[0.04] focus:bg-ink/[0.06] focus:ring-1 focus:ring-accent/60"
              />
            </form>
          </>
        ) : (
          <p className="text-2xs text-fg-4">{ttx('Notes and tasks are written one clip at a time. Label and speaker apply to all {0}.', clips.length)}</p>
        )}
      </div>
    </Section>
  )
}

function TaskRow({ task, onToggle, onRename, onRemove }: { task: ClipTask; onToggle: () => void; onRename: (text: string) => void; onRemove: () => void }) {
  const [text, setText] = useState(task.text)
  useEffect(() => setText(task.text), [task.text])
  return (
    <li className="group/task flex items-center gap-2">
      <input type="checkbox" checked={task.done} onChange={onToggle} aria-label={task.done ? tt('Reopen task') : tt('Tick off task')} className="size-3.5 shrink-0 accent-[var(--color-accent)]" />
      <input
        value={text}
        aria-label={tt('Task')}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => text.trim() !== task.text && onRename(text.trim())}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') (setText(task.text), e.currentTarget.blur())
        }}
        className={cn('h-6 min-w-0 flex-1 rounded bg-transparent px-1 text-sm text-fg-2 outline-none hover:bg-ink/[0.04] focus:bg-ink/[0.07] focus:text-fg focus:ring-1 focus:ring-accent/60', task.done && 'text-fg-4 line-through')}
      />
      <button type="button" aria-label={tt('Remove task')} onClick={onRemove} className="grid size-5 shrink-0 place-items-center rounded text-fg-4 opacity-0 outline-none hover:bg-ink/[0.08] hover:text-fg-2 group-hover/task:opacity-100 focus-visible:opacity-100">
        <X className="size-3" />
      </button>
    </li>
  )
}
