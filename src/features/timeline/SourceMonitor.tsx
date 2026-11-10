/**
 * The source monitor: one media item on its own, to find the part worth using
 * before it goes anywhere near the timeline. Mark an in and an out, then insert
 * or overwrite — with the timeline's own marks that is three- and four-point
 * editing. It floats, so the timeline stays in reach while it is open.
 */
import { ArrowDownToLine, ChevronFirst, ChevronLast, CornerDownRight, Pause, Play, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { Button, IconButton } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { Select } from '@/components/ui/select'
import { framesIn, trackAccepts } from '@/editor/ops'
import { monitorLevel, onMonitorChange, usePlayback } from '@/editor/playback'
import { useEditor } from '@/editor/store'
import { describeEdit, resolveEdit } from '@/editor/three-point'
import { useTimelineView } from '@/editor/timeline-view'
import type { Asset } from '@/editor/types'
import { assetThumb, MiniWave } from '@/features/assets/shared'
import { cn } from '@/lib/cn'
import { clamp } from '@/lib/math'
import { formatTimecode } from '@/lib/time'
import { timelineActions } from './timeline-actions'

export function SourceMonitor() {
  const open = useTimelineView((s) => s.sourceMonitor)
  const asset = useEditor((s) => (open ? s.project.assets[open.assetId] : undefined))
  const set = useTimelineView((s) => s.set)
  // The media was removed from the project while the monitor was showing it.
  useEffect(() => {
    if (open && !asset) set({ sourceMonitor: null })
  }, [open, asset, set])
  if (!open || !asset) return null
  return <Monitor key={asset.id} asset={asset} onClose={() => set({ sourceMonitor: null })} />
}

function Monitor({ asset, onClose }: { asset: Asset; onClose: () => void }) {
  const fps = useEditor((s) => s.project.settings.fps)
  const range = useEditor((s) => s.project.range)
  const tracks = useEditor((s) => s.project.tracks)
  const playhead = usePlayback((s) => s.pausedFrame)
  const marks = useTimelineView((s) => s.sourceMarks[asset.id])
  const fourPoint = useTimelineView((s) => s.fourPoint)
  const markSource = useTimelineView((s) => s.markSource)
  const setView = useTimelineView((s) => s.set)
  const [time, setTime] = useState(marks?.in ?? 0)
  const [playing, setPlaying] = useState(false)
  const [trackId, setTrackId] = useState('auto')
  const [pos, setPos] = useState({ x: 84, y: 64 })
  const mediaRef = useRef<HTMLVideoElement & HTMLAudioElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  const file = asset.source.type === 'file' && !asset.source.missing ? asset.source : null
  const playable = Boolean(file) && asset.kind !== 'image' && asset.duration !== undefined
  const duration = asset.duration ?? 0
  const step = 1 / fps
  const still = !playable

  // The keyboard goes to the monitor when it opens — a moment later, once the menu that opened it has handed focus back.
  useEffect(() => {
    rootRef.current?.focus()
    const timer = setTimeout(() => rootRef.current?.focus(), 60)
    return () => clearTimeout(timer)
  }, [])
  // The monitor plays at the preview's volume, like everything else Lumen plays while editing.
  useEffect(() => {
    const el = mediaRef.current
    if (!el) return
    el.volume = Math.min(1, monitorLevel())
    return onMonitorChange((gain) => (el.volume = Math.min(1, gain)))
  }, [])
  useEffect(() => {
    const el = mediaRef.current
    if (!el) return
    if (marks?.in) el.currentTime = marks.in
    // Once only: where it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const seek = (t: number) => {
    const next = clamp(Math.round(t * fps) / fps, 0, Math.max(0, duration - step))
    setTime(next)
    if (mediaRef.current) mediaRef.current.currentTime = next
  }
  const toggle = () => {
    const el = mediaRef.current
    if (!el) return
    if (el.paused) {
      // Playing from the out point (or the end) starts again from the in point.
      if (marks?.out !== undefined && el.currentTime >= marks.out - step / 2) el.currentTime = marks.in ?? 0
      else if (el.currentTime >= duration - step) el.currentTime = marks?.in ?? 0
      void el.play().catch(() => {})
    } else el.pause()
  }

  const edit = useMemo(
    () =>
      resolveEdit(
        {
          sourceIn: marks?.in !== undefined ? Math.round(marks.in * fps) : undefined,
          sourceOut: marks?.out !== undefined ? Math.round(marks.out * fps) : undefined,
          timelineIn: range?.in,
          timelineOut: range?.out,
          playhead,
          sourceLength: asset.duration !== undefined ? framesIn(asset.duration, fps) : Infinity,
        },
        fps,
        fourPoint,
      ),
    [marks, range, playhead, asset.duration, fps, fourPoint],
  )
  const conflict = edit.points === 4 && marks?.in !== undefined && marks.out !== undefined && range && Math.round((marks.out - marks.in) * fps) !== range.out - range.in
  const targets = tracks.filter((t) => !t.locked && trackAccepts(t, asset.kind))
  const put = (mode: 'insert' | 'overwrite') => timelineActions.sourceEdit(mode, asset.id, trackId === 'auto' ? undefined : trackId)

  /** The keys the monitor answers to while it has the focus; true when it took the key. */
  const handleKey = (key: string, shift: boolean, alt: boolean): boolean => {
    switch (key) {
      case 'escape':
        onClose()
        return true
      case ',':
        put('insert')
        return true
      case '.':
        put('overwrite')
        return true
    }
    if (!playable) return false
    switch (key) {
      case ' ':
        toggle()
        return true
      case 'i':
        if (shift) seek(marks?.in ?? 0)
        else markSource(asset.id, { in: time })
        return true
      case 'o':
        // The out point is exclusive: marking on a frame includes it.
        if (shift) seek((marks?.out ?? duration) - step)
        else markSource(asset.id, { out: Math.min(duration, time + step) })
        return true
      case 'x':
        if (!alt) return false
        markSource(asset.id, { in: null, out: null })
        return true
      case 'arrowleft':
        seek(time - (shift ? 1 : step))
        return true
      case 'arrowright':
        seek(time + (shift ? 1 : step))
        return true
      case 'home':
        seek(0)
        return true
      case 'end':
        seek(duration)
        return true
    }
    return false
  }

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || (e.target as HTMLElement).closest('input,textarea,select,[role="listbox"],[role="option"]')) return
    if (!handleKey(e.key.toLowerCase(), e.shiftKey, e.altKey)) return
    // Keys the monitor takes are its own: the timeline's shortcuts don't see them.
    e.preventDefault()
    e.stopPropagation()
  }

  const drag = (e: ReactPointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return
    e.preventDefault()
    const start = { x: e.clientX - pos.x, y: e.clientY - pos.y }
    const move = (ev: PointerEvent) => setPos({ x: clamp(ev.clientX - start.x, 0, window.innerWidth - 120), y: clamp(ev.clientY - start.y, 0, window.innerHeight - 60) })
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const tc = (sec: number) => formatTimecode(Math.round(sec * fps), fps)
  const thumb = assetThumb(asset)

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      data-source-monitor
      aria-label={`Source monitor: ${asset.name}`}
      onKeyDown={onKeyDown}
      // A press anywhere in the monitor gives it the keyboard (its scrubber and video don't take focus themselves).
      onPointerDownCapture={(e) => {
        if (!(e.target as HTMLElement).closest('button,input,select,[role="combobox"]')) rootRef.current?.focus()
      }}
      className="popover fixed z-[70] flex w-[520px] max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-2xl outline-none focus-within:shadow-[0_0_0_1px_rgb(214_238_0/0.35),0_24px_60px_-12px_rgb(0_0_0/0.85)]"
      style={{ left: pos.x, top: pos.y }}
    >
      <div onPointerDown={drag} className="flex h-10 shrink-0 cursor-grab items-center gap-2 border-b border-line pr-1.5 pl-3 active:cursor-grabbing">
        <span className="text-2xs font-semibold tracking-wider text-fg-4 uppercase">Source</span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">{asset.name}</span>
        <IconButton size="xs" label="Close the source monitor" shortcut="esc" onClick={onClose}>
          <X />
        </IconButton>
      </div>

      <div className="relative grid aspect-video place-items-center bg-black">
        {asset.kind === 'video' && file && (
          <video
            ref={mediaRef}
            src={file.url}
            poster={thumb}
            playsInline
            preload="auto"
            className="h-full w-full object-contain"
            onClick={toggle}
            onTimeUpdate={(e) => {
              const t = e.currentTarget.currentTime
              setTime(t)
              // Playback stops at the out point.
              if (!e.currentTarget.paused && marks?.out !== undefined && t >= marks.out) (e.currentTarget.pause(), seek(marks.out - step))
            }}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
          />
        )}
        {asset.kind === 'audio' && file && (
          <>
            <audio
              ref={mediaRef}
              src={file.url}
              preload="auto"
              onTimeUpdate={(e) => {
                const t = e.currentTarget.currentTime
                setTime(t)
                if (!e.currentTarget.paused && marks?.out !== undefined && t >= marks.out) (e.currentTarget.pause(), seek(marks.out - step))
              }}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
            />
            <button type="button" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'} className="flex h-full w-full items-center px-8 outline-none">
              <MiniWave peaks={asset.peaks} bars={96} className="h-24 w-full text-clip-audio" />
            </button>
          </>
        )}
        {still && (thumb ? <img src={thumb} alt="" className="h-full w-full object-contain" /> : <span className="text-sm text-fg-4">{file ? 'A still: it plays as long as the edit needs' : 'This media can’t be played here'}</span>)}
        {playable && !playing && asset.kind === 'video' && (
          <span className="pointer-events-none absolute grid size-12 place-items-center rounded-full bg-black/55 text-white backdrop-blur-sm">
            <Play className="size-5 translate-x-px" />
          </span>
        )}
      </div>

      {playable && <Scrubber time={time} duration={duration} marks={marks} onSeek={seek} onMark={(patch) => markSource(asset.id, patch)} />}

      {playable && (
        <div className="flex items-center gap-1 px-3 pb-2">
          <IconButton size="sm" label={playing ? 'Pause' : 'Play'} shortcut="space" onClick={toggle}>
            {playing ? <Pause /> : <Play />}
          </IconButton>
          <span className="ml-1 font-mono text-[13px] font-medium text-fg tabular">{tc(time)}</span>
          <span className="font-mono text-2xs text-fg-4 tabular">/ {tc(duration)}</span>
          <div className="ml-auto flex items-center gap-1">
            <Mark label="In" shortcut="i" value={marks?.in} tc={tc} onSet={() => markSource(asset.id, { in: time })} onClear={() => markSource(asset.id, { in: null })} onGo={() => seek(marks?.in ?? 0)} icon={<ChevronFirst />} />
            <Mark
              label="Out"
              shortcut="o"
              value={marks?.out}
              tc={tc}
              onSet={() => markSource(asset.id, { out: Math.min(duration, time + step) })}
              onClear={() => markSource(asset.id, { out: null })}
              onGo={() => seek((marks?.out ?? duration) - step)}
              icon={<ChevronLast />}
            />
          </div>
        </div>
      )}

      <div className="space-y-2 border-t border-line px-3 py-2.5">
        <p className="text-xs leading-relaxed text-fg-3" data-edit-summary>
          {describeEdit(edit, fps, (f) => formatTimecode(f, fps))}
          {!range && edit.points < 3 && <span className="text-fg-4"> — mark in and out on the timeline (I and O there) to say where it goes exactly.</span>}
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          <Select
            aria-label="Track the edit goes on"
            className="w-[150px]"
            value={trackId}
            onChange={setTrackId}
            options={[{ value: 'auto', label: asset.kind === 'audio' ? 'Its own track' : 'Main track', hint: 'Where Lumen would put it' }, ...targets.map((t) => ({ value: t.id, label: t.name }))]}
          />
          {conflict && (
            <Select
              aria-label="When the marked lengths differ"
              className="w-[170px]"
              value={fourPoint}
              onChange={(v) => setView({ fourPoint: v })}
              options={[
                { value: 'source', label: 'Use the source marks', hint: 'The timeline out point is ignored' },
                { value: 'timeline', label: 'Fill the timeline marks', hint: 'The source out point is ignored' },
                { value: 'fit', label: 'Fit to fill', hint: 'The speed changes so the source fills the stretch' },
              ]}
            />
          )}
          <div className="ml-auto flex items-center gap-1.5">
            <Button size="sm" variant="secondary" onClick={() => put('insert')} title="Insert: everything after the point moves later, on every track in sync">
              <CornerDownRight /> Insert <Kbd combo="," />
            </Button>
            <Button size="sm" variant="primary" onClick={() => put('overwrite')} title="Overwrite: covers what is on the track there; nothing moves">
              <ArrowDownToLine /> Overwrite <Kbd combo="." />
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Mark({ label, shortcut, value, tc, onSet, onClear, onGo, icon }: { label: string; shortcut: string; value: number | undefined; tc: (sec: number) => string; onSet: () => void; onClear: () => void; onGo: () => void; icon: ReactNode }) {
  return (
    <span className={cn('flex h-7 items-center rounded-lg text-2xs', value !== undefined ? 'bg-accent/12 text-accent-2 shadow-[inset_0_0_0_1px_rgb(214_238_0/0.3)]' : 'bg-white/[0.05] text-fg-3')}>
      <button type="button" onClick={onSet} title={`Mark ${label.toLowerCase()} here (${shortcut.toUpperCase()})`} className="flex h-full items-center gap-1 rounded-l-lg pr-1 pl-1.5 font-medium outline-none hover:bg-white/[0.08] focus-visible:ring-2 focus-visible:ring-accent/60 [&_svg]:size-3.5">
        {icon}
        {label}
      </button>
      {value !== undefined && (
        <>
          <button type="button" onClick={onGo} title={`Go to the ${label.toLowerCase()} point (Shift+${shortcut.toUpperCase()})`} className="h-full px-1 font-mono tabular outline-none hover:bg-white/[0.08] focus-visible:ring-2 focus-visible:ring-accent/60">
            {tc(value)}
          </button>
          <button type="button" onClick={onClear} aria-label={`Clear the ${label.toLowerCase()} point`} className="grid h-full w-5 place-items-center rounded-r-lg outline-none hover:bg-white/[0.08] focus-visible:ring-2 focus-visible:ring-accent/60">
            <X className="size-3" />
          </button>
        </>
      )}
    </span>
  )
}

/** The media end to end: click or drag to scrub, drag an end of the marked stretch to move that mark. */
function Scrubber({ time, duration, marks, onSeek, onMark }: { time: number; duration: number; marks: { in?: number; out?: number } | undefined; onSeek: (t: number) => void; onMark: (patch: { in?: number; out?: number }) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const at = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect()
    return clamp((clientX - r.left) / r.width, 0, 1) * duration
  }
  const drag = (e: ReactPointerEvent, what: 'seek' | 'in' | 'out') => {
    e.preventDefault()
    e.stopPropagation()
    const apply = (clientX: number) => (what === 'seek' ? onSeek(at(clientX)) : onMark({ [what]: at(clientX) }))
    apply(e.clientX)
    const move = (ev: PointerEvent) => apply(ev.clientX)
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const pct = (t: number) => `${clamp(t / Math.max(duration, 1e-6), 0, 1) * 100}%`
  const a = marks?.in ?? 0
  const b = marks?.out ?? duration
  return (
    <div className="px-3 pt-2.5 pb-2">
      <div ref={ref} data-source-scrubber onPointerDown={(e) => drag(e, 'seek')} className="relative h-5 cursor-pointer touch-none">
        <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-white/[0.09]" />
        {(marks?.in !== undefined || marks?.out !== undefined) && <div className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-accent/60" style={{ left: pct(a), width: `calc(${pct(b)} - ${pct(a)})` }} />}
        {marks?.in !== undefined && <span data-mark="in" onPointerDown={(e) => drag(e, 'in')} className="absolute top-0 h-5 w-2 -translate-x-full cursor-ew-resize rounded-l-[3px] border-y-2 border-l-2 border-accent" style={{ left: pct(a) }} aria-label="In point" />}
        {marks?.out !== undefined && <span data-mark="out" onPointerDown={(e) => drag(e, 'out')} className="absolute top-0 h-5 w-2 cursor-ew-resize rounded-r-[3px] border-y-2 border-r-2 border-accent" style={{ left: pct(b) }} aria-label="Out point" />}
        <span className="pointer-events-none absolute top-0 h-5 w-[2px] -translate-x-1/2 rounded-full bg-white shadow-[0_0_6px_rgb(255_255_255/0.6)]" style={{ left: pct(time) }} />
      </div>
    </div>
  )
}
