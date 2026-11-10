/**
 * Macros: runs of edits recorded on one clip, kept to be done again on
 * others. Recorded from here (or with Alt+R), run from here on whatever is
 * selected, and kept in this profile so they are there in every project.
 */
import { CircleDot, Download, Play, Trash, Upload } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button, IconButton } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Kbd } from '@/components/ui/kbd'
import { addMacros, removeMacro, renameMacro, useMacros } from '@/editor/macro-store'
import { exportMacros, importMacros, type Macro } from '@/editor/macros'
import { useTimelineView } from '@/editor/timeline-view'
import { useUI } from '@/editor/ui-store'
import { cn } from '@/lib/cn'
import { pickTextFile, saveTextFile } from '@/project/text-files'
import { timelineActions } from './timeline-actions'

export function MacrosDialog() {
  const open = useTimelineView((s) => s.macrosOpen)
  const set = useTimelineView((s) => s.set)
  return (
    <Dialog open={open} onOpenChange={(o) => set({ macrosOpen: o })} title="Macros" description="Edits recorded on one clip, to do again on others." className="w-[min(620px,calc(100vw-32px))]">
      {open && <Body onClose={() => set({ macrosOpen: false })} />}
    </Dialog>
  )
}

function Body({ onClose }: { onClose: () => void }) {
  const macros = useMacros((s) => s.macros)
  const lastId = useMacros((s) => s.lastId)
  const selected = useUI((s) => s.selection.length)

  const save = async (list: Macro[], name: string) => {
    try {
      await saveTextFile({ name, extension: 'json', filterName: 'Lumen macros', mime: 'application/json', text: exportMacros(list) }, list.length === 1 ? 'Saved the macro' : `Saved ${list.length} macros`)
    } catch (err) {
      toast.error('Couldn’t save the file', { description: err instanceof Error ? err.message : String(err) })
    }
  }
  const load = async () => {
    const file = await pickTextFile('.json,application/json')
    if (!file) return
    try {
      const n = addMacros(importMacros(file.text))
      toast(n ? `Added ${n} macro${n === 1 ? '' : 's'} from ${file.name}` : `${file.name} holds no macros Lumen can run`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="max-h-[calc(100vh-150px)] space-y-3 overflow-y-auto px-5 pb-5" data-macros>
      <div className="flex items-center gap-2">
        <Button
          variant="primary"
          size="sm"
          onClick={() => {
            if (timelineActions.toggleRecording()) onClose()
          }}
        >
          <CircleDot /> Record a macro
        </Button>
        <span className="flex items-center gap-1 text-2xs text-fg-4">
          <Kbd combo="alt+r" /> starts and stops
        </span>
        <div className="ml-auto flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={() => void load()}>
            <Upload /> Import
          </Button>
          <Button size="sm" variant="ghost" disabled={!macros.length} onClick={() => void save(macros, 'Lumen macros')}>
            <Download /> Export all
          </Button>
        </div>
      </div>

      {macros.length === 0 ? (
        <div className="rounded-xl bg-white/[0.03] p-5 text-center">
          <CircleDot className="mx-auto size-6 text-fg-3" />
          <p className="mt-2 text-sm font-medium text-fg">No macros yet</p>
          <p className="mx-auto mt-1 max-w-[440px] text-xs leading-relaxed text-fg-3">
            Select a clip, press Record, and edit it as you would — grade it, trim it, cut it, add effects. Stop, and those edits are a macro you can run on any other clips: trims and cuts are measured from each clip’s own start and end.
          </p>
        </div>
      ) : (
        <ul className="space-y-1.5">
          {macros.map((m) => (
            <MacroRow key={m.id} macro={m} last={m.id === lastId} selected={selected} onSave={() => void save([m], m.name)} />
          ))}
        </ul>
      )}
      <p className="text-2xs leading-relaxed text-fg-4">
        A macro runs on each selected clip in turn, as one undo step. If a step can’t be done to a clip (it adjusts an effect the clip hasn’t got, say), that clip is left exactly as it was and the rest still get the macro.
      </p>
    </div>
  )
}

function MacroRow({ macro, last, selected, onSave }: { macro: Macro; last: boolean; selected: number; onSave: () => void }) {
  const [name, setName] = useState(macro.name)
  const [open, setOpen] = useState(false)
  return (
    <li className={cn('rounded-lg bg-white/[0.03] p-2 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.04)]', last && 'shadow-[inset_0_0_0_1px_rgb(214_238_0/0.3)]')}>
      <div className="flex items-center gap-2">
        <input
          value={name}
          aria-label="Macro name"
          onChange={(e) => setName(e.target.value)}
          onBlur={() => (name.trim() && name.trim() !== macro.name ? renameMacro(macro.id, name) : setName(macro.name))}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') e.currentTarget.blur()
          }}
          className="h-7 min-w-0 flex-1 rounded-md bg-transparent px-1.5 text-sm font-medium text-fg outline-none hover:bg-white/[0.04] focus:bg-white/[0.07] focus:ring-1 focus:ring-accent/60"
        />
        <button type="button" onClick={() => setOpen(!open)} className="shrink-0 rounded px-1.5 py-0.5 text-2xs text-fg-3 outline-none hover:bg-white/[0.06] hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/60" aria-expanded={open}>
          {macro.steps.length} step{macro.steps.length === 1 ? '' : 's'}
        </button>
        <Button size="xs" variant="secondary" disabled={!selected} onClick={() => timelineActions.runMacro(macro.id)} title={selected ? undefined : 'Select the clips to run it on first'}>
          <Play /> Run on {selected || 'the selection'}
        </Button>
        <IconButton size="xs" label="Save as a file" onClick={onSave}>
          <Download />
        </IconButton>
        <IconButton size="xs" label="Delete this macro" onClick={() => removeMacro(macro.id)}>
          <Trash />
        </IconButton>
      </div>
      {open && (
        <ol className="mt-1.5 list-decimal space-y-0.5 pl-7 text-xs text-fg-3">
          {macro.steps.map((s, i) => (
            <li key={i}>{s.title}</li>
          ))}
        </ol>
      )}
    </li>
  )
}
