import { ArrowLeftRight, Copy, FlipHorizontal2, Flag, LayoutGrid, Magnet, MousePointer2, MoveHorizontal, Rewind, RotateCw, Scissors, SeparatorVertical, SlidersHorizontal, Snowflake, SquareSplitHorizontal, Trash, UnfoldHorizontal, X, ZoomIn, ZoomOut } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { AiSparkle } from '@/components/brand'
import { IconButton } from '@/components/ui/button'
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/menu'
import { Slider } from '@/components/ui/slider'
import { Kbd } from '@/components/ui/kbd'
import { cancelRecording, useMacros } from '@/editor/macro-store'
import { useEditor } from '@/editor/store'
import { useTimelineView } from '@/editor/timeline-view'
import { TRIM_SIDES, trimSides } from '@/editor/trim-mode'
import { exitTrim, setTrimSide, useTrim } from '@/editor/trim-session'
import { cn } from '@/lib/cn'
import { useUI, ZOOM_MAX, ZOOM_MIN } from '@/editor/ui-store'
import { formatDuration } from '@/lib/time'
import { suggestFor, type Suggestion } from '@/editor/smart'
import { useCopilot } from '@/features/copilot/store'
import { actions } from '@/features/shell/actions'
import { timelineActions } from './timeline-actions'
import { RenderMenu } from './RenderMenu'
import { TimelineTools } from './TimelineTools'
import { TimelineSwitcher } from './TimelineSwitcher'
import { tt } from '@/lib/i18n'
import { ttx } from '@/lib/i18n-react'

export function TimelineToolbar() {
  const tool = useUI((s) => s.tool)
  const setTool = useUI((s) => s.setTool)
  const snapping = useUI((s) => s.snapping)
  const toggleSnapping = useUI((s) => s.toggleSnapping)
  const pps = useUI((s) => s.pxPerSecond)
  const setZoom = useUI((s) => s.setZoom)
  const hasSelection = useUI((s) => s.selection.length > 0)
  const storyboard = useTimelineView((s) => s.storyboard)
  const setView = useTimelineView((s) => s.set)

  return (
    <div className="flex h-11 shrink-0 items-center gap-1 border-b border-line px-2">
      <TimelineSwitcher />
      <IconButton size="sm" label={storyboard ? tt('Back to the lanes') : tt('Storyboard — the timeline as cards')} shortcut="shift+s" active={storyboard} onClick={() => setView({ storyboard: !storyboard })}>
        <LayoutGrid />
      </IconButton>
      <div className="mx-1 h-4 w-px bg-line-2" />
      <div className="flex items-center gap-0.5 rounded-group bg-well-2 p-[3px] shadow-[inset_0_0_0_1px_rgb(from_var(--color-ink)_r_g_b/0.04)]">
        <IconButton size="xs" label={tt('Select')} shortcut="v" active={tool === 'select'} onClick={() => setTool('select')}>
          <MousePointer2 />
        </IconButton>
        <IconButton size="xs" label={tt('Blade')} shortcut="b" active={tool === 'blade'} onClick={() => setTool('blade')}>
          <Scissors />
        </IconButton>
        <IconButton size="xs" label={tt('Roll — move a cut between two clips')} shortcut="r" active={tool === 'roll'} onClick={() => setTool('roll')}>
          <SeparatorVertical />
        </IconButton>
        <IconButton size="xs" label={tt('Slip — change the footage in place')} shortcut="y" active={tool === 'slip'} onClick={() => setTool('slip')}>
          <ArrowLeftRight />
        </IconButton>
        <IconButton size="xs" label={tt('Slide — move a clip between its neighbours')} shortcut="u" active={tool === 'slide'} onClick={() => setTool('slide')}>
          <MoveHorizontal />
        </IconButton>
      </div>
      <div className="mx-1.5 h-4 w-px bg-line-2" />
      <IconButton label={tt('Split at playhead')} shortcut="s" onClick={actions.split}>
        <SquareSplitHorizontal />
      </IconButton>
      <IconButton label={tt('Duplicate')} shortcut="mod+d" disabled={!hasSelection} onClick={actions.duplicateSelection}>
        <Copy />
      </IconButton>
      <IconButton label={tt('Delete')} shortcut="delete" disabled={!hasSelection} onClick={() => actions.deleteSelection(false)}>
        <Trash />
      </IconButton>
      <MoreEditMenu />
      <div className="mx-1.5 h-4 w-px bg-line-2" />
      <IconButton label={snapping ? tt('Snapping on') : tt('Snapping off')} shortcut="n" active={snapping} onClick={toggleSnapping}>
        <Magnet />
      </IconButton>
      <IconButton label={tt('Add marker')} shortcut="m" onClick={actions.addMarker}>
        <Flag />
      </IconButton>

      <RangeChip />
      <TrimChip />
      <RecordingChip />

      <div className="flex min-w-0 flex-1 justify-center px-3">
        <CopilotHint />
      </div>

      <TimelineTools />
      <RenderMenu />
      <div className="mx-1 h-4 w-px bg-line-2" />

      <IconButton label={tt('Zoom out')} shortcut="-" onClick={() => actions.zoom(1 / 1.35)}>
        <ZoomOut />
      </IconButton>
      <div className="w-28">
        <Slider
          aria-label={tt('Timeline zoom')}
          value={Math.log(pps)}
          min={Math.log(ZOOM_MIN)}
          max={Math.log(ZOOM_MAX)}
          step={0.01}
          onChange={(v) => setZoom(Math.exp(v))}
        />
      </div>
      <IconButton label={tt('Zoom in')} shortcut="=" onClick={() => actions.zoom(1.35)}>
        <ZoomIn />
      </IconButton>
      <IconButton label={tt('Zoom to fit')} shortcut="shift+z" onClick={actions.zoomToFit}>
        <UnfoldHorizontal />
      </IconButton>
    </div>
  )
}

/** The quick edits of CapCut's “More edit”: freeze, reverse, mirror, rotate — on the selected clip, or the one under the playhead. */
function MoreEditMenu() {
  return (
    <Menu>
      <MenuTrigger asChild>
        <IconButton label={tt('More edits')}>
          <SlidersHorizontal />
        </IconButton>
      </MenuTrigger>
      <MenuContent align="start">
        <MenuItem icon={<Snowflake />} shortcut="shift+f" onSelect={actions.freezeFrame}>
          {tt('Freeze frame')}
        </MenuItem>
        <MenuItem icon={<Rewind />} onSelect={actions.toggleReverse}>
          {tt('Reverse')}
        </MenuItem>
        <MenuItem icon={<FlipHorizontal2 />} onSelect={actions.mirror}>
          {tt('Mirror')}
        </MenuItem>
        <MenuItem icon={<RotateCw />} onSelect={actions.rotate}>
          {tt('Rotate')}
        </MenuItem>
      </MenuContent>
    </Menu>
  )
}

/** The marked in / out stretch, with a way to clear it. */
function RangeChip() {
  const range = useEditor((s) => s.project.range)
  const fps = useEditor((s) => s.project.settings.fps)
  if (!range) return null
  return (
    <div className="ml-1 flex h-6 shrink-0 items-center gap-1 rounded-full bg-accent/10 pr-0.5 pl-2 text-2xs font-medium text-accent-2 shadow-[inset_0_0_0_1px_rgb(from_var(--color-accent)_r_g_b/0.25)]">
      <button type="button" onClick={actions.goToIn} className="font-mono tabular hover:text-fg" title={tt('In to out — click to go to the in point (Shift+I)')}>
        {ttx('In–Out {0}', formatDuration(range.out - range.in, fps))}
      </button>
      <button type="button" aria-label={tt('Clear in and out')} onClick={actions.clearInOut} className="grid size-5 place-items-center rounded-full text-accent-2/80 hover:bg-ink/[0.08] hover:text-fg">
        <X className="size-3" />
      </button>
    </div>
  )
}

/** Trim mode: which side of the cut is being trimmed, and the keys that do it. */
function TrimChip() {
  const cut = useTrim((s) => s.cut)
  const side = useTrim((s) => s.side)
  const tracks = useEditor((s) => s.project.tracks)
  if (!cut) return null
  const sides = trimSides(cut, { tracks })
  return (
    <div data-trim-chip className="ml-1 flex h-7 shrink-0 items-center gap-2 rounded-full bg-accent/10 pr-0.5 pl-2.5 text-2xs font-medium text-accent-2 shadow-[inset_0_0_0_1px_rgb(from_var(--color-accent)_r_g_b/0.3)]">
      <span className="font-semibold">{tt('Trim')}</span>
      <div className="flex items-center gap-0.5">
        {TRIM_SIDES.filter((s) => sides.includes(s.id)).map((s) => (
          <button
            key={s.id}
            type="button"
            title={s.hint}
            aria-pressed={side === s.id}
            onClick={() => setTrimSide(s.id)}
            className={cn('h-5 rounded-full px-2 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/60', side === s.id ? 'bg-accent text-accent-fg' : 'text-accent-2/80 hover:bg-ink/[0.08] hover:text-fg')}
          >
            {s.label}
          </button>
        ))}
      </div>
      <span className="hidden items-center gap-1 text-fg-3 xl:flex">
        <Kbd combo="j" bound />
        <Kbd combo="l" bound />{' '}{tt('play')}
        <Kbd combo="k" className="ml-1" />{' '}{tt('trim here')}
        <Kbd combo="left" className="ml-1" />
        <Kbd combo="right" />{' '}{tt('nudge')}
      </span>
      <button type="button" aria-label={tt('Leave trim mode')} title={tt('Leave trim mode (Esc)')} onClick={exitTrim} className="grid size-5 place-items-center rounded-full text-accent-2/80 hover:bg-ink/[0.08] hover:text-fg">
        <X className="size-3" />
      </button>
    </div>
  )
}

/** A macro being recorded: how many steps so far, what was left out, and the way to stop. */
function RecordingChip() {
  const recording = useMacros((s) => s.recording)
  const name = useEditor((s) => (recording ? s.project.clips[recording.clipId]?.name : undefined))
  if (!recording) return null
  return (
    <div data-recording-chip className="ml-1 flex h-7 shrink-0 items-center gap-2 rounded-full bg-danger/12 pr-0.5 pl-2.5 text-2xs font-medium text-danger shadow-[inset_0_0_0_1px_rgb(from_var(--color-danger)_r_g_b/0.35)]">
      <span className="size-2 animate-pulse rounded-full bg-danger" />
      <span className="max-w-[220px] truncate" title={recording.skipped.length ? tt('Left out:\n{0}', recording.skipped.join('\n')) : undefined}>
        {ttx('Recording{0} · {1} step{2}', name ? (' ' + tt('on “{0}”', name)) : '', recording.steps.length, recording.steps.length === 1 ? '' : 's')}
        {recording.skipped.length > 0 && <span className="text-fg-3">{' '}{ttx('· {0} left out', recording.skipped.length)}</span>}
      </span>
      <button type="button" onClick={() => void timelineActions.toggleRecording()} title={tt('Stop and keep the macro (Alt+R)')} className="h-5 rounded-full bg-danger px-2 font-semibold text-ink-fg outline-none hover:brightness-110 focus-visible:ring-2 focus-visible:ring-accent/60">
        {tt('Stop')}
      </button>
      <button type="button" aria-label={tt('Discard the recording')} title={tt('Discard the recording')} onClick={cancelRecording} className="grid size-5 place-items-center rounded-full text-danger/80 hover:bg-ink/[0.08] hover:text-fg">
        <X className="size-3" />
      </button>
    </div>
  )
}

function CopilotHint() {
  const project = useEditor((s) => s.project)
  const busy = useCopilot((s) => s.busy)
  const [dismissed, setDismissed] = useState<string[]>([])
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null)
  const [running, setRunning] = useState(false)
  // Analysis reads real audio, so it runs a moment after edits settle.
  useEffect(() => {
    let alive = true
    const timer = setTimeout(() => {
      void suggestFor(project).then((s) => alive && setSuggestion(s))
    }, 800)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [project.clips, project.tracks, project.assets]) // eslint-disable-line react-hooks/exhaustive-deps
  const visible = suggestion && !dismissed.includes(suggestion.id) && !busy
  const act = async () => {
    if (!suggestion || running) return
    setRunning(true)
    try {
      toast.success(await suggestion.run())
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setRunning(false)
    }
  }

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key={suggestion.id}
          initial={{ opacity: 0, y: 6, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -4, scale: 0.97 }}
          transition={{ type: 'spring', stiffness: 420, damping: 32 }}
          data-busy={running || undefined}
          className="ring-ai flex h-7 min-w-0 items-center gap-2 rounded-full bg-ink/[0.035] pr-1 pl-2.5 text-xs"
        >
          <AiSparkle className="size-3.5 shrink-0" />
          <span className="truncate text-fg-2">{suggestion.text}</span>
          <button
            type="button"
            disabled={running}
            onClick={() => void act()}
            className="shrink-0 rounded-full bg-ink/[0.09] px-2.5 py-1 font-medium text-fg transition-colors hover:bg-ink/[0.16]"
          >
            {suggestion.action}
          </button>
          <button
            type="button"
            aria-label={tt('Dismiss suggestion')}
            onClick={() => setDismissed((d) => [...d, suggestion.id])}
            className="grid size-5 shrink-0 place-items-center rounded-full text-fg-4 hover:bg-ink/[0.08] hover:text-fg-2"
          >
            <X className="size-3" />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
