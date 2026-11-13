/**
 * Auto-direct: cut a multicam clip between its cameras by who is speaking —
 * and, when asked to watch the footage, by where the picture moves. The plan
 * is shown before anything is cut, and re-made as the settings change.
 */
import { Clapperboard, Eye, LoaderCircle } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Select } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { LABEL_COLORS } from '@/editor/clip-colors'
import { clipsAt } from '@/editor/ops'
import { usePlayback } from '@/editor/playback'
import { useEditor } from '@/editor/store'
import { useTimelineView } from '@/editor/timeline-view'
import type { Project } from '@/editor/types'
import { useUI } from '@/editor/ui-store'
import { AnalysisCancelled } from '@/engine/analysis'
import { formatDuration } from '@/lib/time'
import { angleMotion, applyAutoDirect, multicamTargets, planAutoDirect, type AutoDirectPlan } from '@/project/auto-director'
import { tt } from '@/lib/i18n'
import { ttx } from '@/lib/i18n-react'

const ANGLE_COLORS = LABEL_COLORS.filter((c) => c.id !== 'gray').map((c) => c.css)

const WHY: Record<string, string> = { opening: tt('opens here'), speaker: tt('takes over'), everyone: tt('several speak'), quiet: tt('nobody speaks'), reaction: tt('a look at who is listening') }

/** The multicam clips to direct: the selected ones, else the one under the playhead. */
function targetIds(project: Project): string[] {
  const selected = useUI.getState().selection.filter((id) => {
    const c = project.clips[id]
    return c?.sequenceId && project.sequences?.[c.sequenceId]?.multicam
  })
  if (selected.length) return selected
  return clipsAt(project, usePlayback.getState().frame)
    .filter((c) => c.sequenceId && project.sequences?.[c.sequenceId]?.multicam)
    .map((c) => c.id)
    .slice(0, 1)
}

export function DirectorDialog() {
  const open = useTimelineView((s) => s.directorOpen)
  const set = useTimelineView((s) => s.set)
  return (
    <Dialog open={open} onOpenChange={(o) => set({ directorOpen: o })} title={tt('Auto-direct multicam')} description={tt('Cuts between the cameras the way a vision mixer would.')} className="w-[min(640px,calc(100vw-32px))]">
      {open && <Body onClose={() => set({ directorOpen: false })} />}
    </Dialog>
  )
}

function Body({ onClose }: { onClose: () => void }) {
  const project = useEditor((s) => s.project)
  const fps = project.settings.fps
  // The clips are fixed when the dialog opens: applying the plan cuts them into pieces.
  const [ids] = useState(() => targetIds(project))
  const targets = useMemo(() => multicamTargets(project, ids), [project, ids])
  const [minShot, setMinShot] = useState(2.5)
  const [maxShot, setMaxShot] = useState(14)
  const [wide, setWide] = useState('none')
  const [lead, setLead] = useState(true)
  const [reactions, setReactions] = useState(true)
  const [motion, setMotion] = useState<(number[] | undefined)[] | undefined>()
  const [watching, setWatching] = useState<number | null>(null)
  const abort = useRef<AbortController | null>(null)
  useEffect(() => () => abort.current?.abort(), [])

  const plan = useMemo<AutoDirectPlan | { error: string } | null>(() => {
    if (!targets) return null
    try {
      return planAutoDirect(project, ids, { minShot, maxShot, wide: wide === 'none' ? null : Number(wide), lead: lead ? 0.25 : 0, reactions }, motion)
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  }, [project, ids, targets, minShot, maxShot, wide, lead, reactions, motion])

  if (!targets)
    return (
      <div className="px-5 pb-6">
        <div className="rounded-xl bg-ink/[0.03] p-5 text-center">
          <Clapperboard className="mx-auto size-6 text-fg-3" />
          <p className="mt-2 text-sm font-medium text-fg">{tt('No multicam clip here')}</p>
          <p className="mx-auto mt-1 max-w-[420px] text-xs leading-relaxed text-fg-3">
            {tt('Select a multicam clip, or put the playhead on one. A multicam clip is made from recordings of the same moment — choose them in the Media panel, then “Make a multicam clip”.')}
          </p>
        </div>
      </div>
    )

  const watch = async () => {
    const controller = new AbortController()
    abort.current = controller
    setWatching(0)
    try {
      setMotion(await angleMotion(project, targets.seq, setWatching, controller.signal))
    } catch (err) {
      if (!(err instanceof AnalysisCancelled)) toast.error(tt('Couldn’t watch the footage'), { description: err instanceof Error ? err.message : String(err) })
    } finally {
      setWatching(null)
    }
  }
  const apply = () => {
    if (!plan || 'error' in plan) return
    try {
      const r = applyAutoDirect(plan)
      useUI.getState().select(r.clipIds)
      toast.success(r.cuts ? tt('Made {0} cut{1} between {2} cameras', r.cuts, r.cuts === 1 ? '' : 's', plan.angles.length) : tt('The clip is on the right camera throughout'), { description: tt('One undo step. Any cut can still be rolled, or a piece switched with keys 1–9.') })
      onClose()
    } catch (err) {
      toast.error(tt('Couldn’t make the cuts'), { description: err instanceof Error ? err.message : String(err) })
    }
  }

  const angles = targets.seq.tracks.filter((t) => t.kind === 'video')
  const total = targets.clips.reduce((n, c) => n + c.duration, 0)

  return (
    <div className="max-h-[calc(100vh-150px)] space-y-4 overflow-y-auto px-5 pb-5" data-director>
      <p className="text-xs leading-relaxed text-fg-3">
        {ttx('{0} · {1} cameras · {2}. Each camera’s own microphone says when its speaker is talking: the cut goes there a beat early, out to the wide shot when several speak or nobody does, and away for a reaction when one shot runs long.', targets.clips.length === 1 ? `“${targets.clips[0].name}”` : tt('{0} clips of “{1}”', targets.clips.length, targets.seq.name), angles.length, formatDuration(total, fps))}
      </p>

      <div className="grid grid-cols-2 gap-x-5 gap-y-3">
        <label className="space-y-1">
          <span className="flex justify-between text-xs text-fg-3">
            {tt('Shortest shot')}{' '}<span className="text-fg-2 tabular">{minShot.toFixed(1)} s</span>
          </span>
          <Slider aria-label={tt('Shortest shot')} value={minShot} min={1} max={8} step={0.5} onChange={setMinShot} />
        </label>
        <label className="space-y-1">
          <span className="flex justify-between text-xs text-fg-3">
            {tt('Longest shot')}{' '}<span className="text-fg-2 tabular">{maxShot.toFixed(0)} s</span>
          </span>
          <Slider aria-label={tt('Longest shot')} value={maxShot} min={6} max={40} step={1} onChange={setMaxShot} />
        </label>
        <div className="space-y-1">
          <span className="text-xs text-fg-3">{tt('Wide shot')}</span>
          <Select
            aria-label={tt('The camera that shows everyone')}
            className="w-full"
            value={wide}
            onChange={setWide}
            options={[{ value: 'none', label: tt('None'), hint: tt('Every camera is on one person') }, ...angles.map((t, i) => ({ value: String(i), label: t.name, hint: tt('Used when several speak, or nobody does') }))]}
          />
        </div>
        <div className="space-y-2 pt-1">
          <label className="flex items-center gap-2 text-xs text-fg-2">
            <Switch aria-label={tt('Cut a beat ahead of the speaker')} checked={lead} onChange={setLead} />{' '}{tt('Cut a beat ahead of the speaker')}
          </label>
          <label className="flex items-center gap-2 text-xs text-fg-2">
            <Switch aria-label={tt('Reaction shots on long takes')} checked={reactions} onChange={setReactions} />{' '}{tt('Reaction shots on long takes')}
          </label>
        </div>
      </div>

      <div className="flex items-center gap-2 rounded-lg bg-ink/[0.03] px-3 py-2">
        <Eye className="size-4 shrink-0 text-fg-3" />
        <span className="min-w-0 flex-1 text-xs leading-relaxed text-fg-3">
          {motion ? tt('The picture was watched: where a camera’s picture moves counts towards cutting to it.') : tt('Also watch the picture: movement tips the balance between cameras, and stands in for sound where a camera has none. It reads every frame, so it takes a while.')}
        </span>
        {watching !== null ? (
          <Button size="sm" variant="secondary" onClick={() => abort.current?.abort()}>
            <LoaderCircle className="animate-spin" />{' '}{ttx('{0}% · Stop', Math.round(watching * 100))}
          </Button>
        ) : (
          <Button size="sm" variant="secondary" onClick={() => (motion ? setMotion(undefined) : void watch())}>
            {motion ? tt('Sound only') : tt('Watch the picture')}
          </Button>
        )}
      </div>

      {plan && 'error' in plan ? (
        <p className="rounded-lg bg-warn/10 px-3 py-2 text-sm text-fg-2">{plan.error}</p>
      ) : plan ? (
        <>
          <PlanStrip plan={plan} />
          {plan.silent.length > 0 && (
            <p className="text-2xs leading-relaxed text-warn">
              {ttx('{0} {1} no sound of {2} own to go by{3}.', plan.silent.map((i) => plan.angles[i]).join(', '), plan.silent.length === 1 ? tt('has') : tt('have'), plan.silent.length === 1 ? tt('its') : tt('their'), wide !== 'none' && plan.silent.includes(Number(wide)) ? (' ' + tt('— fine for the wide shot')) : tt(': it is only cut to if you watch the picture, or set it as the wide shot'))}
            </p>
          )}
        </>
      ) : null}

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          {tt('Cancel')}
        </Button>
        <Button variant="primary" disabled={!plan || 'error' in plan} onClick={apply}>
          <Clapperboard /> {plan && !('error' in plan) && plan.summary.cuts ? tt('Make {0} cuts', plan.summary.cuts) : tt('Apply')}
        </Button>
      </div>
    </div>
  )
}

/** The plan at a glance: the multicam timeline as a strip, coloured by the camera each stretch is on. */
function PlanStrip({ plan }: { plan: AutoDirectPlan }) {
  const seconds = Math.max(plan.seconds, 1e-6)
  return (
    <div data-director-plan>
      <div className="relative h-7 overflow-hidden rounded-md bg-shade/30 shadow-[inset_0_0_0_1px_rgb(from_var(--color-ink)_r_g_b/0.06)]">
        {plan.cuts.map((c, i) => {
          const end = plan.cuts[i + 1]?.at ?? seconds
          return (
            <span
              key={`${c.at}:${c.angle}`}
              title={tt('{0} — {1}, for {2} s', plan.angles[c.angle], WHY[c.why], (end - c.at).toFixed(1))}
              className="absolute inset-y-0 border-r border-shade/50"
              style={{ left: `${(c.at / seconds) * 100}%`, width: `${((end - c.at) / seconds) * 100}%`, background: ANGLE_COLORS[c.angle % ANGLE_COLORS.length], opacity: c.why === 'reaction' ? 0.65 : 0.9 }}
            />
          )
        })}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-fg-3">
        {plan.angles.map((name, i) => (
          <span key={name} className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-handle" style={{ background: ANGLE_COLORS[i % ANGLE_COLORS.length] }} />
            {name} <span className="text-fg-4 tabular">{Math.round(plan.summary.share[i] * 100)}%</span>
          </span>
        ))}
        <span className="ml-auto text-fg-4 tabular">
          {ttx('{0} cut{1} · a shot every {2} s', plan.summary.cuts, plan.summary.cuts === 1 ? '' : 's', plan.summary.averageShot.toFixed(1))}
        </span>
      </div>
    </div>
  )
}
