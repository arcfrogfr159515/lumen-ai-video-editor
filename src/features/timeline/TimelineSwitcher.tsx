import { ArrowLeft, Check, ChevronDown, CopyPlus, Film, GitBranch, GitCompare, Layers, PencilLine, Plus, Smartphone, Trash, Video } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button, IconButton } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuSub, MenuTrigger } from '@/components/ui/menu'
import { CANVAS_PRESETS } from '@/editor/new-project'
import { allSequences, clipsLength, getSequence, openSequenceId, openSequenceName, usesOf } from '@/editor/sequences'
import { reframe } from '@/editor/smart'
import { dispatch, getProject, useEditor } from '@/editor/store'
import { openTimeline, timelineBack, useTimelineNav } from '@/editor/timeline-nav'
import { useTimelineView } from '@/editor/timeline-view'
import { timelineActions } from './timeline-actions'
import { useUI } from '@/editor/ui-store'
import { cn } from '@/lib/cn'
import { formatDuration } from '@/lib/time'
import { tt } from '@/lib/i18n'
import { ttx } from '@/lib/i18n-react'

const PRESETS = CANVAS_PRESETS.filter((p) => ['landscape', 'vertical', 'square', 'portrait'].includes(p.id))

/** New timeline, open it. */
function newTimeline(settings?: { width: number; height: number }, name?: string) {
  const res = dispatch('sequence.create', { name, settings })
  if (!res.ok) toast(res.error)
}

/** A copy of the open timeline in another shape, reframed to fit (one undo step). */
function reshapedCopy(width: number, height: number, label: string) {
  const p = getProject()
  useEditor.getState().transaction(tt('{0} copy', label), 'user', () => {
    const res = dispatch('sequence.duplicate', { id: openSequenceId(p), name: `${openSequenceName(p)} · ${label}`, open: true })
    if (res.ok) reframe(width, height, 'user')
  })
}

function deleteTimeline(id: string) {
  const p = getProject()
  const seq = getSequence(p, id)
  if (!seq) return
  const uses = usesOf(p, id)
  if (uses.length) return void toast(tt('“{0}” is nested in {1}', seq.name, uses.map((u) => `“${u.name}”`).join(', ')), { description: tt('Remove it there first.') })
  const others = allSequences(p).filter((s) => s.id !== id)
  if (!others.length) return
  useEditor.getState().transaction(tt('Delete {0}', seq.name), 'user', () => {
    if (id === openSequenceId(getProject())) dispatch('sequence.open', { id: others[0].id })
    const res = dispatch('sequence.delete', { id })
    if (!res.ok) toast(res.error)
  })
}

/** The open timeline's name, a menu of every timeline, and the way back out of a nested one. */
export function TimelineSwitcher() {
  const project = useEditor((s) => s.project)
  const trail = useTimelineNav((s) => s.trail)
  const sequences = useMemo(() => allSequences(project), [project])
  const { settings, sequence: sequenceRef } = project
  const openId = openSequenceId(project)
  const name = openSequenceName(project)
  const back = trail[trail.length - 1]

  return (
    <div className="flex min-w-0 items-center gap-0.5">
      {back && (
        <IconButton size="xs" label={tt('Back to {0}', back.name)} onClick={timelineBack}>
          <ArrowLeft />
        </IconButton>
      )}
      <Menu>
        <MenuTrigger asChild>
          <button
            type="button"
            className="flex h-7 max-w-[220px] min-w-0 items-center gap-1.5 rounded-[9px] px-2 text-xs font-semibold text-fg-2 outline-none transition-colors hover:bg-white/[0.06] hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/60 data-[state=open]:bg-white/[0.08]"
            title={tt('Timelines')}
          >
            {trail.length > 0 && <span className="truncate font-medium text-fg-4">{trail.map((t) => t.name).join(' › ')} ›</span>}
            {sequenceRef?.multicam ? <Video className="size-3.5 shrink-0 text-accent-2" /> : <Layers className="size-3.5 shrink-0 text-fg-3" />}
            <span className="truncate">{name}</span>
            {sequences.length > 1 && <span className="rounded bg-white/[0.07] px-1 text-2xs/[inherit] font-medium text-fg-4 tabular">{sequences.length}</span>}
            <ChevronDown className="size-3 shrink-0 text-fg-4" />
          </button>
        </MenuTrigger>
        <MenuContent className="w-72">
          <MenuLabel>{tt('Timelines')}</MenuLabel>
          {sequences.map((s) => (
            <MenuItem key={s.id} icon={s.id === openId ? <Check /> : s.multicam ? <Video /> : s.branchOf ? <GitBranch /> : <Film />} onSelect={() => openTimeline(s.id)}>
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <span className={cn('truncate', s.id === openId && 'text-fg')}>{s.name}</span>
                <span className="ml-auto shrink-0 font-mono text-2xs/[inherit] text-fg-4 tabular">
                  {s.settings.width}×{s.settings.height} · {formatDuration(clipsLength(s.clips), s.settings.fps)}
                </span>
              </span>
            </MenuItem>
          ))}
          <MenuSeparator />
          <MenuSub icon={<Plus />} label={tt('New timeline')}>
            <MenuItem onSelect={() => newTimeline()}>
              {tt('Same shape')}{' '}<span className="ml-auto text-fg-4">{settings.width}×{settings.height}</span>
            </MenuItem>
            {PRESETS.map((p) => (
              <MenuItem key={p.id} onSelect={() => newTimeline({ width: p.width, height: p.height }, tt('{0} timeline', p.label))}>
                {p.label} <span className="ml-auto text-fg-4">{p.hint.split(' · ')[0]}</span>
              </MenuItem>
            ))}
          </MenuSub>
          <MenuSub icon={<Smartphone />} label={tt('Copy in another shape')}>
            {PRESETS.filter((p) => p.width !== settings.width || p.height !== settings.height).map((p) => (
              <MenuItem key={p.id} onSelect={() => reshapedCopy(p.width, p.height, p.label)}>
                {p.label} <span className="ml-auto text-fg-4">{p.hint.split(' · ')[0]}</span>
              </MenuItem>
            ))}
          </MenuSub>
          <MenuItem icon={<CopyPlus />} onSelect={() => dispatch('sequence.duplicate', { id: openId, open: true })}>
            {ttx('Duplicate “{0}”', name)}
          </MenuItem>
          {!sequenceRef?.multicam && (
            <MenuItem icon={<GitBranch />} onSelect={() => timelineActions.branch()}>
              {ttx('Branch “{0}”', name)}
            </MenuItem>
          )}
          <MenuItem icon={<GitCompare />} onSelect={() => useTimelineView.getState().set({ compareOpen: true })}>
            {tt('Compare versions…')}
          </MenuItem>
          <MenuItem icon={<PencilLine />} onSelect={() => useUI.getState().setRenamingTimeline(openId)}>
            {tt('Rename…')}
          </MenuItem>
          <MenuItem icon={<Trash />} danger disabled={sequences.length < 2} onSelect={() => deleteTimeline(openId)}>
            {ttx('Delete “{0}”', name)}
          </MenuItem>
        </MenuContent>
      </Menu>
    </div>
  )
}

/** Names a timeline. */
export function RenameTimelineDialog() {
  const id = useUI((s) => s.renamingTimeline)
  const [name, setName] = useState('')
  useEffect(() => {
    if (id) setName(getSequence(getProject(), id)?.name ?? '')
  }, [id])
  const close = () => useUI.getState().setRenamingTimeline(null)
  const save = () => {
    if (!id || !name.trim()) return
    const res = dispatch('sequence.rename', { id, name: name.trim() })
    if (!res.ok) toast(res.error)
    close()
  }
  return (
    <Dialog open={Boolean(id)} onOpenChange={(o) => !o && close()} title={tt('Rename timeline')} className="w-[min(400px,calc(100vw-32px))]">
      <form
        className="flex flex-col gap-4 px-5 pb-5"
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
      >
        <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.stopPropagation()} placeholder={tt('Timeline name')} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={close}>
            {tt('Cancel')}
          </Button>
          <Button type="submit" variant="primary" disabled={!name.trim()}>
            {tt('Rename')}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
