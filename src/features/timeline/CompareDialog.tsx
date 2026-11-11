/**
 * Compare versions: this timeline and another — a branch, usually — side by
 * side. The stretches where they differ are marked on both, the two pictures
 * play in step (each at its own time where an earlier stretch changed length),
 * and a stretch that works better in the other version can be taken into this one.
 */
import { ArrowDownToLine, GitBranch, Pause, Play, SkipBack, SkipForward } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { toast } from 'sonner'
import { Button, IconButton } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Select } from '@/components/ui/select'
import { diffTimelines, hunkAt, mapFrame, pairTracks, type Hunk, type TimelineDiff, type Version } from '@/editor/diff'
import { clipEnd } from '@/editor/ops'
import { usePlayback } from '@/editor/playback'
import { allSequences, compareTarget, openSequence, openSequenceId, sequenceView } from '@/editor/sequences'
import { dispatch, useEditor } from '@/editor/store'
import { useTimelineView } from '@/editor/timeline-view'
import type { Project, Sequence } from '@/editor/types'
import { renderFrame } from '@/engine/compositor'
import { withVideoFrames } from '@/engine/media'
import { FrameFeeder } from '@/engine/stills'
import { cn } from '@/lib/cn'
import { clamp } from '@/lib/math'
import { formatDuration, formatTimecode } from '@/lib/time'
import { CLIP_COLOR } from './model'
import { cssColor } from './strips'
import { tt } from '@/lib/i18n'
import { ttx } from '@/lib/i18n-react'

const HUNK_COLOR: Record<Hunk['kind'], string> = { changed: 'var(--color-warn)', added: 'var(--color-ok)', removed: 'var(--color-danger)' }
const HUNK_WORD: Record<Hunk['kind'], string> = { changed: tt('Different'), added: tt('Only there'), removed: tt('Only here') }

export function CompareDialog() {
  const open = useTimelineView((s) => s.compareOpen)
  const set = useTimelineView((s) => s.set)
  return (
    <Dialog open={open} onOpenChange={(o) => set({ compareOpen: o })} title={tt('Compare versions')} description={tt('This timeline beside another: where they differ, and what to take from it.')} className="w-[min(1040px,calc(100vw-32px))]">
      {open && <Body />}
    </Dialog>
  )
}


function Body() {
  const project = useEditor((s) => s.project)
  const openId = openSequenceId(project)
  const others = useMemo(() => allSequences(project).filter((s) => s.id !== openId && !s.multicam), [project, openId])
  const [otherId, setOtherId] = useState<string | null>(() => compareTarget(project))
  const other = otherId ? project.sequences?.[otherId] : undefined
  const mine = useMemo(() => openSequence(project), [project])
  const fps = project.settings.fps
  const comparable = Boolean(other) && other!.settings.fps === fps
  const diff = useMemo(() => (other && comparable ? diffTimelines(mine, other) : null), [mine, other, comparable])
  const [pos, setPosition] = useState(() => usePlayback.getState().frame)
  const posRef = useRef(pos)
  const setPos = (frame: number) => {
    posRef.current = frame
    setPosition(frame)
  }
  const [playing, setPlaying] = useState(false)
  const length = diff ? Math.max(1, diff.lengthA) : 1
  const at = clamp(pos, 0, Math.max(0, length - 1))
  const there = diff ? mapFrame(diff, at) : 0
  const inHunk = diff ? hunkAt(diff, at) : undefined

  // Playing steps the position at the timeline's rate, as fast as the two pictures can be drawn.
  useEffect(() => {
    if (!playing) return
    let last = performance.now()
    let carry = 0
    const id = setInterval(() => {
      const now = performance.now()
      carry += ((now - last) / 1000) * fps
      last = now
      const step = Math.floor(carry)
      if (!step) return
      carry -= step
      const next = Math.min(length - 1, posRef.current + step)
      posRef.current = next
      setPosition(next)
      if (next >= length - 1) setPlaying(false)
    }, 1000 / 30)
    return () => clearInterval(id)
  }, [playing, fps, length])

  const branch = () => {
    const res = dispatch('sequence.branch', {})
    if (!res.ok) return void toast(res.error)
    // The branch opens: what it is compared with is where it came from.
    setOtherId(openId)
    toast.success(tt('Branched'), { description: tt('You are now on the branch. Edit it, then compare to take back what works.') })
  }
  const take = (hunks: Hunk[]) => {
    if (!other) return
    let failed: string | undefined
    // Last first, so the earlier ones are still where they were found.
    useEditor.getState().transaction(hunks.length === 1 ? tt('Take a stretch from {0}', other.name) : tt('Take {0} stretches from {1}', hunks.length, other.name), 'user', () => {
      for (const h of [...hunks].sort((x, y) => y.a[0] - x.a[0])) {
        const res = dispatch('timeline.mergeFrom', { sequenceId: other.id, a: { start: h.a[0], end: h.a[1] }, b: { start: h.b[0], end: h.b[1] } })
        if (!res.ok) failed = res.error
      }
    })
    if (failed) toast.error(failed)
    else toast.success(hunks.length === 1 ? tt('Taken into this timeline') : tt('Took {0} stretches', hunks.length), { description: tt('One undo step.') })
  }
  const jump = (dir: 1 | -1) => {
    if (!diff) return
    const starts = diff.hunks.map((h) => h.a[0])
    const next = dir > 0 ? starts.find((f) => f > at) : [...starts].reverse().find((f) => f < at)
    if (next !== undefined) setPos(next)
  }

  if (!others.length)
    return (
      <div className="px-5 pb-6">
        <div className="rounded-xl bg-white/[0.03] p-5 text-center">
          <GitBranch className="mx-auto size-6 text-fg-3" />
          <p className="mt-2 text-sm font-medium text-fg">{tt('There is only one version of this timeline')}</p>
          <p className="mx-auto mt-1 max-w-[440px] text-xs leading-relaxed text-fg-3">{tt('A branch is a full copy to try another cut on. Edit the branch freely; then compare the two here and take back the stretches that work better.')}</p>
          <Button variant="primary" className="mt-4" onClick={branch}>
            <GitBranch />{' '}{tt('Branch this timeline')}
          </Button>
        </div>
      </div>
    )

  return (
    <div className="max-h-[calc(100vh-130px)] space-y-3 overflow-y-auto px-5 pb-5" data-compare>
      <div className="flex items-center gap-2">
        <span className="text-xs text-fg-3">{tt('Compare with')}</span>
        <Select
          aria-label={tt('The version to compare with')}
          className="w-[260px]"
          value={otherId ?? ''}
          onChange={(v) => (setOtherId(v), setPlaying(false))}
          options={others.map((s) => ({ value: s.id, label: s.name, hint: s.branchOf?.sequenceId === openId ? tt('A branch of this timeline') : project.sequence?.branchOf?.sequenceId === s.id ? tt('Where this branch came from') : undefined }))}
        />
        <Button size="sm" variant="secondary" className="ml-auto" onClick={branch}>
          <GitBranch />{' '}{tt('Branch this timeline')}
        </Button>
      </div>

      {!other ? null : !comparable ? (
        <p className="rounded-lg bg-warn/10 px-3 py-2 text-sm text-fg-2">
          {ttx('“{0}” runs at {1} fps and this timeline at {2}. Their frames don’t line up, so they can’t be compared stretch by stretch.', other.name, other.settings.fps, fps)}
        </p>
      ) : diff ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Viewer label={mine.name} sub="This timeline" project={project} frame={at} fps={fps} marked={inHunk?.kind} />
            <Viewer label={other.name} sub="The other version" project={sequenceView(project, other.id) ?? project} frame={there} fps={fps} marked={inHunk?.kind} />
          </div>

          <Strips mine={mine} other={other} diff={diff} at={at} there={there} onSeek={(f) => (setPlaying(false), setPos(f))} />

          <div className="flex items-center gap-1">
            <IconButton size="sm" label={tt('Previous difference')} onClick={() => jump(-1)} disabled={!diff.hunks.length}>
              <SkipBack />
            </IconButton>
            <IconButton size="sm" label={playing ? tt('Pause') : tt('Play both in step (pictures only)')} onClick={() => (at >= length - 1 && !playing ? (setPos(0), setPlaying(true)) : setPlaying(!playing))}>
              {playing ? <Pause /> : <Play />}
            </IconButton>
            <IconButton size="sm" label={tt('Next difference')} onClick={() => jump(1)} disabled={!diff.hunks.length}>
              <SkipForward />
            </IconButton>
            <span className="ml-2 text-xs text-fg-3" data-compare-summary>
              {diff.hunks.length === 0
                ? tt('The two play exactly the same.')
                : tt('{0} stretch{1} differ: {2} here, {3} there.', diff.hunks.length, diff.hunks.length === 1 ? '' : tt('es'), formatDuration(diff.framesA, fps), formatDuration(diff.framesB, fps))}
            </span>
            {diff.hunks.length > 1 && (
              <Button size="sm" variant="secondary" className="ml-auto" onClick={() => take(diff.hunks)}>
                <ArrowDownToLine />{' '}{ttx('Take all {0}', diff.hunks.length)}
              </Button>
            )}
          </div>

          {diff.hunks.length > 0 && (
            <ul className="space-y-1">
              {diff.hunks.map((h) => {
                const here = h.a[1] > h.a[0] ? `${formatTimecode(h.a[0], fps)} · ${formatDuration(h.a[1] - h.a[0], fps)}` : tt('nothing at {0}', formatTimecode(h.a[0], fps))
                const thereText = h.b[1] > h.b[0] ? `${formatTimecode(h.b[0], fps)} · ${formatDuration(h.b[1] - h.b[0], fps)}` : tt('nothing at {0}', formatTimecode(h.b[0], fps))
                return (
                  <li key={`${h.a[0]}:${h.b[0]}:${h.kind}`} className={cn('flex items-center gap-2.5 rounded-lg bg-white/[0.03] px-2.5 py-1.5 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.04)]', inHunk === h && 'bg-white/[0.07]')}>
                    <span className="h-6 w-1 shrink-0 rounded-full" style={{ background: HUNK_COLOR[h.kind] }} />
                    <button type="button" onClick={() => (setPlaying(false), setPos(h.a[0]))} title={tt('Show this stretch')} className="min-w-0 flex-1 rounded text-left outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/60">
                      <span className="block truncate text-sm text-fg-2">
                        {HUNK_WORD[h.kind]} <span className="text-fg-4">·</span> <span className="font-mono text-xs tabular">{here}</span>
                      </span>
                      <span className="block truncate text-2xs text-fg-4">
                        {tt('There:')}{' '}<span className="font-mono tabular">{thereText}</span>
                      </span>
                    </button>
                    <Button size="xs" variant="secondary" onClick={() => take([h])} title={h.kind === 'removed' ? tt('Take this stretch out of this timeline, as the other version has') : tt('Make this timeline play what the other version plays here')}>
                      <ArrowDownToLine /> {h.kind === 'removed' ? tt('Remove here too') : tt('Take theirs')}
                    </Button>
                  </li>
                )
              })}
            </ul>
          )}
        </>
      ) : null}
    </div>
  )
}

/** One version's picture at a frame, drawn exactly as an export would draw it. */
function Viewer({ label, sub, project, frame, fps, marked }: { label: string; sub: string; project: Project; frame: number; fps: number; marked: Hunk['kind'] | undefined }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const feeder = useRef<FrameFeeder | null>(null)
  const want = useRef({ project, frame })
  const busy = useRef(false)
  const { width, height } = project.settings
  const w = 480
  const h = Math.max(2, Math.round((w * height) / width / 2) * 2)

  useEffect(() => {
    want.current = { project, frame }
    // One frame is drawn at a time; while it is, only the newest request is kept.
    const draw = async () => {
      if (busy.current) return
      busy.current = true
      try {
        for (;;) {
          const now = want.current
          const f = (feeder.current ??= new FrameFeeder(now.project, w, h))
          f.project = now.project
          await f.prepare(now.frame).catch(() => {})
          const canvas = canvasRef.current
          // Closed while the frame was being decoded: its feeder is gone, and there is nothing to draw on.
          if (!canvas || feeder.current !== f) return
          withVideoFrames(f.frame, () => renderFrame(canvas.getContext('2d')!, now.project, now.frame))
          if (want.current === now) return
        }
      } finally {
        busy.current = false
      }
    }
    void draw()
  }, [project, frame, w, h])
  useEffect(
    () => () => {
      feeder.current?.dispose()
      feeder.current = null
    },
    [],
  )

  return (
    <div>
      <div
        className={cn('relative overflow-hidden rounded-lg bg-black shadow-[inset_0_0_0_1px_rgb(255_255_255/0.08)] transition-shadow')}
        style={marked ? { boxShadow: `0 0 0 2px ${HUNK_COLOR[marked]}` } : undefined}
        data-compare-viewer={marked ?? 'same'}
      >
        <canvas ref={canvasRef} width={w} height={h} className="block h-auto w-full" />
        {marked && (
          <span className="absolute top-1.5 left-1.5 rounded-md px-1.5 py-0.5 text-2xs/[inherit] font-semibold text-black" style={{ background: HUNK_COLOR[marked] }}>
            {HUNK_WORD[marked]}
          </span>
        )}
      </div>
      <div className="mt-1 flex items-baseline gap-2 px-0.5">
        <span className="min-w-0 truncate text-xs font-medium text-fg-2">{label}</span>
        <span className="shrink-0 text-2xs text-fg-4">{sub}</span>
        <span className="ml-auto shrink-0 font-mono text-2xs text-fg-3 tabular">{formatTimecode(frame, fps)}</span>
      </div>
    </div>
  )
}

const STRIP_H = 34
const LINK_H = 16

/** The two versions as strips, one above the other, with the stretches that differ joined between them. */
function Strips({ mine, other, diff, at, there, onSeek }: { mine: Version; other: Sequence; diff: TimelineDiff; at: number; there: number; onSeek: (frame: number) => void }) {
  const total = Math.max(1, diff.lengthA, diff.lengthB)
  const pairs = useMemo(() => pairTracks(mine.tracks, other.tracks), [mine.tracks, other.tracks])
  const pct = (f: number) => `${(f / total) * 100}%`
  const x = (f: number) => (f / total) * 1000

  const seek = (e: ReactPointerEvent, side: 'a' | 'b') => {
    e.preventDefault()
    const el = e.currentTarget as HTMLElement
    const apply = (clientX: number) => {
      const r = el.getBoundingClientRect()
      const f = Math.round(clamp((clientX - r.left) / r.width, 0, 1) * total)
      onSeek(side === 'a' ? Math.min(f, Math.max(0, diff.lengthA - 1)) : mapFrame(diff, Math.min(f, Math.max(0, diff.lengthB - 1)), 'b'))
    }
    apply(e.clientX)
    const move = (ev: PointerEvent) => apply(ev.clientX)
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const strip = (version: Version, side: 0 | 1, playhead: number) => (
    <div data-compare-strip={side === 0 ? 'a' : 'b'} onPointerDown={(e) => seek(e, side === 0 ? 'a' : 'b')} className="relative cursor-pointer touch-none overflow-hidden rounded-md bg-black/30 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.06)]" style={{ height: STRIP_H }}>
      {pairs.map((pair, row) => {
        const track = pair[side]
        if (!track) return null
        const rowH = (STRIP_H - 4) / pairs.length
        return Object.values(version.clips)
          .filter((c) => c.trackId === track.id)
          .map((c) => (
            <span
              key={c.id}
              className="absolute rounded-[1.5px]"
              style={{ left: pct(c.start), width: `max(1px, calc(${pct(clipEnd(c) - c.start)} - 1px))`, top: 2 + row * rowH, height: Math.max(1.5, rowH - 1), background: cssColor(c.sequenceId ? 'var(--color-clip-nest)' : CLIP_COLOR[c.kind]), opacity: 0.8 }}
            />
          ))
      })}
      {diff.hunks.map((h) => {
        const [from, to] = side === 0 ? h.a : h.b
        return <span key={`${h.a[0]}:${h.b[0]}`} className="pointer-events-none absolute inset-y-0" style={{ left: pct(from), width: to > from ? pct(to - from) : 2, background: HUNK_COLOR[h.kind], opacity: to > from ? 0.28 : 0.9 }} />
      })}
      <span className="pointer-events-none absolute inset-y-0 w-[2px] -translate-x-1/2 bg-white shadow-[0_0_6px_rgb(255_255_255/0.6)]" style={{ left: pct(playhead) }} />
    </div>
  )

  return (
    <div>
      {strip(mine, 0, at)}
      <svg viewBox={`0 0 1000 ${LINK_H}`} preserveAspectRatio="none" className="block w-full" style={{ height: LINK_H }} aria-hidden>
        {diff.hunks.map((h) => (
          <polygon key={`${h.a[0]}:${h.b[0]}`} points={`${x(h.a[0])},0 ${Math.max(x(h.a[1]), x(h.a[0]) + 1)},0 ${Math.max(x(h.b[1]), x(h.b[0]) + 1)},${LINK_H} ${x(h.b[0])},${LINK_H}`} fill={HUNK_COLOR[h.kind]} fillOpacity={0.3} />
        ))}
      </svg>
      {strip(other, 1, there)}
    </div>
  )
}
