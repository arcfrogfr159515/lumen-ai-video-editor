/**
 * Clean-up: what an edit tends to leave behind, in one place. Gaps and flash
 * frames (closed in one go), footage that plays more than once, and footage
 * whose frame rate wanders (given a constant-rate copy).
 */
import { CircleCheck, Copy, Eraser, Gauge, LoaderCircle, RotateCcw, Scissors, SquareDashed, TriangleAlert } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Segmented } from '@/components/ui/segmented'
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { constantRateFor, describeTiming, isUneven, rateLabel } from '@/editor/frame-rate'
import { cleanupDidNothing, describeCleanup, findGaps, FLASH_FRAMES, type CloseGapsResult } from '@/editor/gaps'

import { playback } from '@/editor/playback'
import { reusedFrames } from '@/editor/reuse'
import { dispatch, useEditor } from '@/editor/store'
import type { Asset, Project } from '@/editor/types'
import { useUI } from '@/editor/ui-store'
import { cn } from '@/lib/cn'
import { desktop } from '@/lib/platform'
import { formatDuration, formatTimecode } from '@/lib/time'
import { canConform, cancelConform, checkFrameTiming, conformWithToast, restoreOriginal, unevenAssets, useConformJobs } from '@/project/conform'
import { reuseOf } from './reuse-view'
import { useTimelineView, type CleanupTab } from '@/editor/timeline-view'

const goTo = (frame: number, clipId?: string) => {
  playback.pause()
  playback.seek(frame)
  if (clipId) useUI.getState().select([clipId])
}

export function CleanupDialog() {
  const tab = useTimelineView((s) => s.cleanup)
  const set = useTimelineView((s) => s.set)
  return (
    <Dialog
      open={tab !== null}
      onOpenChange={(o) => !o && set({ cleanup: null })}
      title="Clean up the timeline"
      description="Gaps and flash frames, footage used twice, and footage whose frame rate wanders."
      className="w-[min(720px,calc(100vw-32px))]"
    >
      {tab !== null && <Body tab={tab} setTab={(t) => set({ cleanup: t })} />}
    </Dialog>
  )
}

function Body({ tab, setTab }: { tab: CleanupTab; setTab: (t: CleanupTab) => void }) {
  const project = useEditor((s) => s.project)
  const [flashFrames, setFlashFrames] = useState(FLASH_FRAMES)
  const report = useMemo(() => findGaps(project, flashFrames), [project, flashFrames])
  const reuse = reuseOf(project)
  const uneven = unevenAssets(project.assets).length
  const problems = report.holes.length + report.gaps.filter((g) => g.flash).length + report.flashClips.length
  return (
    <div className="flex max-h-[calc(100vh-150px)] min-h-[340px] flex-col">
      <div className="shrink-0 px-5 pb-3">
        <Segmented
          stretch
          size="md"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'gaps', label: <Tab icon={<SquareDashed />} label="Gaps" count={problems} /> },
            { value: 'reuse', label: <Tab icon={<Copy />} label="Used twice" count={reuse.spans.length} /> },
            { value: 'rates', label: <Tab icon={<Gauge />} label="Frame rates" count={uneven} /> },
          ]}
        />
      </div>
      {tab === 'gaps' && <GapsPane project={project} flashFrames={flashFrames} setFlashFrames={setFlashFrames} />}
      {tab === 'reuse' && <ReusePane project={project} />}
      {tab === 'rates' && <RatesPane project={project} />}
    </div>
  )
}

function Tab({ icon, label, count }: { icon: ReactNode; label: string; count: number }) {
  return (
    <span className="flex items-center gap-1.5">
      {icon}
      {label}
      {count > 0 && <span className="rounded-full bg-warn/20 px-1.5 text-[10px] leading-4 font-semibold text-warn tabular">{count}</span>}
    </span>
  )
}

function Clean({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-8 py-10 text-center">
      <CircleCheck className="size-8 text-ok" />
      <p className="max-w-[380px] text-sm leading-relaxed text-fg-3">{children}</p>
    </div>
  )
}

function Row({ icon, title, detail, trailing, onClick }: { icon: ReactNode; title: ReactNode; detail?: ReactNode; trailing?: ReactNode; onClick?: () => void }) {
  return (
    <li className="flex items-center gap-2.5 rounded-lg bg-white/[0.03] px-2.5 py-1.5 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.04)]">
      <span className="shrink-0 text-fg-3 [&_svg]:size-4">{icon}</span>
      <button type="button" disabled={!onClick} onClick={onClick} title={onClick ? 'Go there' : undefined} className="min-w-0 flex-1 rounded text-left outline-none enabled:hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/60">
        <div className="truncate text-sm text-fg-2">{title}</div>
        {detail && <div className="truncate text-2xs text-fg-4">{detail}</div>}
      </button>
      {trailing}
    </li>
  )
}

// ─── Gaps ────────────────────────────────────────────────────────────────

function GapsPane({ project, flashFrames, setFlashFrames }: { project: Project; flashFrames: number; setFlashFrames: (n: number) => void }) {
  const fps = project.settings.fps
  const report = useMemo(() => findGaps(project, flashFrames), [project, flashFrames])
  const [holes, setHoles] = useState(true)
  const [slivers, setSlivers] = useState(true)
  const [flashes, setFlashes] = useState(true)
  const [tracks, setTracks] = useState<string[]>([])
  const trackName = (id: string) => project.tracks.find((t) => t.id === id)?.name ?? ''
  const tc = (f: number) => formatTimecode(f, fps)
  const sliverGaps = report.gaps.filter((g) => g.flash)
  const wide = report.gaps.filter((g) => !g.flash)
  const byTrack = project.tracks
    .map((t) => ({ track: t, gaps: wide.filter((g) => g.trackId === t.id) }))
    .filter((x) => x.gaps.length > 0)
  const chosen = tracks.filter((id) => byTrack.some((x) => x.track.id === id && !x.track.rippleLock))
  const todo = (holes ? report.holes.length : 0) + (slivers ? sliverGaps.length : 0) + (flashes ? report.flashClips.length : 0) + chosen.length

  const run = () => {
    const res = dispatch('timeline.closeGaps', { holes, flashGaps: slivers, flashClips: flashes, flashFrames, trackIds: chosen })
    if (!res.ok) return void toast.error(res.error)
    const done = res.result as CloseGapsResult
    if (cleanupDidNothing(done)) toast(describeCleanup(done, fps))
    else toast.success('Timeline cleaned up', { description: describeCleanup(done, fps) })
  }

  const clean = !report.holes.length && !sliverGaps.length && !report.flashClips.length
  return (
    <>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 pb-4">
        {clean && !byTrack.length ? (
          <Clean>No holes, no slivers of empty space and no flash frames. Every track that has clips runs without a break.</Clean>
        ) : (
          <>
            {clean && (
              <p className="flex items-center gap-2 rounded-lg bg-ok/10 px-3 py-2 text-sm text-fg-2">
                <CircleCheck className="size-4 shrink-0 text-ok" />
                No holes, no slivers of empty space and no flash frames.
              </p>
            )}
            <Group
              title="Holes"
              hint="Nothing plays on any track: black and silent in the film. Closing one moves everything after it earlier, on every track that follows ripples."
              count={report.holes.length}
              on={holes}
              setOn={setHoles}
            >
              {report.holes.map((h) => (
                <Row key={h.start} icon={<SquareDashed />} title={`${tc(h.start)} → ${tc(h.end)}`} detail={`${formatDuration(h.frames, fps)} of nothing`} onClick={() => goTo(h.start)} />
              ))}
            </Group>
            <Group
              title="Slivers"
              hint={`Up to ${flashFrames} empty frame${flashFrames === 1 ? '' : 's'} between two clips: a flash of whatever is underneath. The clip before runs that much longer (or the clip after starts earlier), so nothing else moves.`}
              count={sliverGaps.length}
              on={slivers}
              setOn={setSlivers}
            >
              {sliverGaps.map((g) => (
                <Row key={`${g.trackId}:${g.start}`} icon={<SquareDashed />} title={`${tc(g.start)} on ${trackName(g.trackId)}`} detail={`${g.frames} frame${g.frames === 1 ? '' : 's'}${g.leading ? ' before the first clip' : ''}`} onClick={() => goTo(g.start)} />
              ))}
            </Group>
            <Group
              title="Flash frames"
              hint={`Clips ${flashFrames} frame${flashFrames === 1 ? '' : 's'} long or shorter — usually what a split left behind. They are removed and a neighbour takes up the frames.`}
              count={report.flashClips.length}
              on={flashes}
              setOn={setFlashes}
            >
              {report.flashClips.map((c) => (
                <Row key={c.clipId} icon={<Scissors />} title={`${c.name} at ${tc(c.start)}`} detail={`${c.frames} frame${c.frames === 1 ? '' : 's'} on ${trackName(c.trackId)}`} onClick={() => goTo(c.start, c.clipId)} />
              ))}
            </Group>
            {byTrack.length > 0 && (
              <section>
                <h3 className="text-2xs font-semibold tracking-wider text-fg-4 uppercase">Space between clips, by track</h3>
                <p className="mt-1 mb-2 text-xs leading-relaxed text-fg-4">
                  Often meant — a title that comes in later, music that pauses. Tick a track to close every gap on it by moving its later clips up; linked clips move with them, and the track will line up with the others differently.
                </p>
                <ul className="space-y-1">
                  {byTrack.map(({ track, gaps }) => (
                    <Row
                      key={track.id}
                      icon={<Eraser />}
                      title={track.name}
                      detail={`${gaps.length} gap${gaps.length === 1 ? '' : 's'}, ${formatDuration(gaps.reduce((n, g) => n + g.frames, 0), fps)} in all${track.rippleLock ? ' — ripple-locked, so they stay' : ''}`}
                      onClick={() => goTo(gaps[0].start)}
                      trailing={
                        <Switch
                          aria-label={`Close the gaps on ${track.name}`}
                          disabled={Boolean(track.rippleLock)}
                          checked={chosen.includes(track.id)}
                          onChange={(v) => setTracks((list) => (v ? [...list, track.id] : list.filter((id) => id !== track.id)))}
                        />
                      }
                    />
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-3 border-t border-line px-5 py-3">
        <span className="text-xs text-fg-3">A flash is up to</span>
        <Select aria-label="How short counts as a flash" className="w-[110px]" value={String(flashFrames)} onChange={(v) => setFlashFrames(Number(v))} options={[1, 2, 3, 4, 5, 6, 8].map((n) => ({ value: String(n), label: `${n} frame${n === 1 ? '' : 's'}` }))} />
        <Button variant="primary" className="ml-auto" disabled={todo === 0} onClick={run}>
          <Eraser /> Clean up{todo ? ` (${todo})` : ''}
        </Button>
      </div>
    </>
  )
}

function Group({ title, hint, count, on, setOn, children }: { title: string; hint: string; count: number; on: boolean; setOn: (v: boolean) => void; children: ReactNode }) {
  if (!count) return null
  return (
    <section>
      <div className="flex items-center gap-2">
        <h3 className="text-2xs font-semibold tracking-wider text-fg-4 uppercase">
          {title} <span className="text-fg-3 tabular">{count}</span>
        </h3>
        <Switch className="ml-auto" aria-label={`Fix ${title.toLowerCase()}`} checked={on} onChange={setOn} />
      </div>
      <p className="mt-1 mb-2 text-xs leading-relaxed text-fg-4">{hint}</p>
      <ul className={cn('space-y-1 transition-opacity', !on && 'opacity-45')}>{children}</ul>
    </section>
  )
}

// ─── Used twice ──────────────────────────────────────────────────────────

function ReusePane({ project }: { project: Project }) {
  const fps = project.settings.fps
  const { spans } = reuseOf(project)
  const show = useTimelineView((s) => s.showReuse)
  const set = useTimelineView((s) => s.set)
  const total = reusedFrames(spans)
  return (
    <>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 pb-4">
        {spans.length === 0 ? (
          <Clean>No stretch of footage plays twice. Every clip shows a different part of its media.</Clean>
        ) : (
          spans.map((span) => {
            const asset = project.assets[span.assetId]
            return (
              <section key={`${span.assetId}:${span.stream}:${span.from}`} className="rounded-xl bg-white/[0.03] p-3 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.04)]">
                <div className="flex items-baseline gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">{asset?.name ?? 'Missing media'}</span>
                  <span className="shrink-0 rounded bg-white/[0.06] px-1.5 py-px text-2xs text-fg-3">{span.stream === 'sound' ? 'Sound' : 'Picture'}</span>
                </div>
                <div className="mt-0.5 text-2xs text-fg-4">
                  {formatDuration(span.to - span.from, fps)} of it, from {formatTimecode(span.from, fps)} in the file, plays {span.uses.length} times:
                </div>
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {span.uses.map((u) => {
                    const clip = project.clips[u.clipId]
                    if (!clip) return null
                    return (
                      <li key={u.clipId}>
                        <button
                          type="button"
                          title="Go to this use"
                          onClick={() => goTo(clip.start + u.start, clip.id)}
                          className="flex h-6 items-center gap-1.5 rounded-full bg-white/[0.05] px-2 text-2xs text-fg-2 outline-none hover:bg-white/[0.1] hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/60"
                        >
                          <span className="font-mono tabular">{formatTimecode(clip.start + u.start, fps)}</span>
                          <span className="text-fg-4">{project.tracks.find((t) => t.id === clip.trackId)?.name}</span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </section>
            )
          })
        )}
      </div>
      <div className="flex shrink-0 items-center gap-3 border-t border-line px-5 py-3 text-xs text-fg-3">
        <Switch aria-label="Mark reused footage on the timeline" checked={show} onChange={(v) => set({ showReuse: v })} />
        Mark it on the clips
        {total > 0 && <span className="ml-auto text-fg-4">{formatDuration(total, fps)} of the timeline is footage seen before</span>}
      </div>
    </>
  )
}

// ─── Frame rates ─────────────────────────────────────────────────────────

function RatesPane({ project }: { project: Project }) {
  const jobs = useConformJobs((s) => s.jobs)
  const [checking, setChecking] = useState(false)
  const videos = Object.values(project.assets).filter((a) => a.kind === 'video' && a.source.type === 'file' && !a.matteOf)
  const unchecked = videos.filter((a) => !a.frameTiming && !a.conformedFrom && !(a.source.type === 'file' && a.source.missing))
  const uneven = unevenAssets(project.assets)

  const check = async () => {
    setChecking(true)
    try {
      const found = await checkFrameTiming()
      toast(found.length ? `${found.length} video${found.length === 1 ? ' has' : 's have'} an uneven frame rate` : 'Every video has a constant frame rate')
    } finally {
      setChecking(false)
    }
  }
  const conformAll = async () => {
    for (const a of uneven) await conformWithToast(a.id)
  }

  return (
    <>
      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-5 pb-4">
        <p className="pb-2 text-xs leading-relaxed text-fg-4">
          Phones, screen recorders and game capture write a frame whenever one is ready, so the time between frames wanders. Lumen plays such footage by its timestamps, but an even grid steps and scrubs frame by frame, and cuts land where you put them. A constant-rate copy is made at the footage’s own size; the original file is never changed.
        </p>
        {videos.length === 0 ? (
          <Clean>There are no videos in the project yet.</Clean>
        ) : (
          <ul className="space-y-1">
            {videos.map((a) => (
              <RateRow key={a.id} asset={a} fps={project.settings.fps} progress={jobs[a.id]} />
            ))}
          </ul>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2 border-t border-line px-5 py-3">
        {!desktop && <span className="mr-auto max-w-[320px] text-2xs leading-snug text-fg-4">In a browser tab a copy is kept in memory for this session. The desktop app writes it to Lumen’s media folder.</span>}
        <Button className={cn(desktop && 'ml-auto')} disabled={checking || unchecked.length === 0} onClick={() => void check()}>
          {checking ? <LoaderCircle className="animate-spin" /> : <Gauge />} Check {unchecked.length || ''} unchecked
        </Button>
        <Button variant="primary" disabled={uneven.length === 0 || Object.keys(jobs).length > 0} onClick={() => void conformAll()}>
          Make {uneven.length > 1 ? `all ${uneven.length}` : 'it'} constant
        </Button>
      </div>
    </>
  )
}

function RateRow({ asset, fps, progress }: { asset: Asset; fps: number; progress: number | undefined }) {
  const timing = asset.frameTiming
  const uneven = isUneven(timing)
  const copy = Boolean(asset.conformedFrom)
  const [rate, setRate] = useState<string>('auto')
  const suggested = timing ? constantRateFor(timing, fps) : fps
  const rates = [...new Set([suggested, fps, 24, 25, 30, 50, 60])].sort((a, b) => a - b)
  const busy = progress !== undefined
  return (
    <Row
      icon={copy ? <CircleCheck className="text-ok" /> : uneven ? <TriangleAlert className="text-warn" /> : timing ? <CircleCheck className="text-fg-4" /> : <Gauge />}
      title={asset.name}
      detail={copy ? `Plays a constant ${rateLabel(asset.fps ?? fps)} fps copy · was: ${describeTiming(asset.conformedFrom?.frameTiming).toLowerCase()}` : describeTiming(timing)}
      trailing={
        busy ? (
          <div className="flex shrink-0 items-center gap-2">
            <div className="h-1.5 w-24 overflow-hidden rounded-full bg-white/[0.08]">
              <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
            <span className="w-8 text-right text-2xs text-fg-3 tabular">{Math.round(progress * 100)}%</span>
            <Button size="xs" variant="ghost" onClick={() => cancelConform(asset.id)}>
              Stop
            </Button>
          </div>
        ) : copy ? (
          <Button size="xs" variant="secondary" className="shrink-0" onClick={() => void restoreOriginal(asset.id)}>
            <RotateCcw /> Use the original
          </Button>
        ) : canConform(asset) && (uneven || timing) ? (
          <div className="flex shrink-0 items-center gap-1.5">
            <Select
              aria-label="Frame rate of the copy"
              className="w-[112px]"
              value={rate}
              onChange={setRate}
              options={[{ value: 'auto', label: `${rateLabel(suggested)} fps`, hint: 'What suits this footage and the timeline' }, ...rates.filter((r) => r !== suggested).map((r) => ({ value: String(r), label: `${rateLabel(r)} fps` }))]}
            />
            <Button size="xs" variant={uneven ? 'primary' : 'secondary'} onClick={() => void conformWithToast(asset.id, rate === 'auto' ? undefined : Number(rate))}>
              Make constant
            </Button>
          </div>
        ) : undefined
      }
    />
  )
}

