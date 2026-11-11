/**
 * Speed curve editor: how fast the clip plays along its length, as points
 * joined by Bézier curves. Drag a point to set a speed, drag its handles to
 * shape how it gets there, double-click to add or remove a point. The clip
 * keeps the same footage, so its length follows the curve — and the strip
 * underneath shows which part of the footage plays when.
 */
import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { ScrubInput } from '@/components/ui/scrub-input'
import { SPEED_RAMPS } from '@/editor/presets'
import { curveLength, curvePoints, dragHandle, footageCurve, handlePosition, insertPoint, movePoint, rampInput, removePoint, SEGMENT_SHAPES, shapeSegment, speedOnCurve, type CurvePoint } from '@/editor/speed-curve'
import { dispatch, useEditor } from '@/editor/store'
import { consumed, isRamped, MAX_SPEED, MIN_SPEED } from '@/editor/timing'
import type { Clip } from '@/editor/types'
import { cn } from '@/lib/cn'
import { clamp } from '@/lib/math'
import { formatDuration } from '@/lib/time'
import { tt } from '@/lib/i18n'
import { ttx } from '@/lib/i18n-react'

const W = 260
const H = 120
const PAD = 8
// Speed runs on a log scale: 0.1× at the bottom, 16× at the top, 1× a third of the way up.
const LOG_MIN = Math.log2(MIN_SPEED)
const LOG_MAX = Math.log2(MAX_SPEED)
const toY = (speed: number) => PAD + (1 - (Math.log2(clamp(speed, MIN_SPEED, MAX_SPEED)) - LOG_MIN) / (LOG_MAX - LOG_MIN)) * (H - PAD * 2)
const fromY = (y: number) => 2 ** (LOG_MIN + (1 - (y - PAD) / (H - PAD * 2)) * (LOG_MAX - LOG_MIN))
const toX = (at: number) => PAD + at * (W - PAD * 2)
const fromX = (x: number) => (x - PAD) / (W - PAD * 2)
const GRID = [0.25, 0.5, 1, 2, 4, 8]
const FOOT_H = 30

const round = (s: number) => Math.round(s * 100) / 100

export function SpeedRamp({ clip }: { clip: Clip }) {
  const fps = useEditor((s) => s.project.settings.fps)
  const ramped = isRamped(clip)
  const [points, setPoints] = useState<CurvePoint[]>(() => curvePoints(clip))
  const [selected, setSelected] = useState<number | null>(null)
  const dragging = useRef(false)
  const svgRef = useRef<SVGSVGElement>(null)
  // The footage the clip plays stays the same whatever the curve: it is what the curve is measured against.
  const used = useRef(consumed(clip))
  // Follow the clip (undo, presets, the AI) whenever we're not mid-drag.
  useEffect(() => {
    if (dragging.current) return
    setPoints(curvePoints(clip))
    used.current = consumed(clip)
  }, [clip])
  const sel = selected !== null && selected < points.length ? selected : null

  const commit = (next: CurvePoint[], key?: string) => dispatch('clip.setSpeedRamp', { id: clip.id, points: rampInput(next) }, { coalesce: key })
  const change = (next: CurvePoint[], key?: string) => {
    setPoints(next)
    commit(next, key)
  }

  const local = (e: { clientX: number; clientY: number }) => {
    const r = svgRef.current!.getBoundingClientRect()
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H }
  }

  /** A drag on the graph: `move` turns each pointer position into the curve it makes. */
  const drag = (e: ReactPointerEvent, move: (current: CurvePoint[], at: number, speed: number, alt: boolean) => CurvePoint[]) => {
    e.preventDefault()
    e.stopPropagation()
    dragging.current = true
    const key = `ramp:${clip.id}:${Date.now()}`
    let current = points
    const onMove = (ev: PointerEvent) => {
      const p = local(ev)
      current = move(current, fromX(p.x), fromY(p.y), ev.altKey)
      setPoints(current)
      commit(current, key)
    }
    const up = () => {
      dragging.current = false
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', up)
  }

  const dragPoint = (e: ReactPointerEvent, index: number) => {
    setSelected(index)
    drag(e, (current, at, speed, alt) => {
      let s = clamp(speed, MIN_SPEED, MAX_SPEED)
      // Real time is where most ramps want to rest: it catches, unless Alt is held.
      if (!alt && Math.abs(Math.log2(s)) < 0.08) s = 1
      return movePoint(current, index, at, s)
    })
  }
  const dragHandleOf = (e: ReactPointerEvent, segment: number, which: 0 | 1) => drag(e, (current, at, speed) => dragHandle(current, segment, which, at, speed))

  const addAt = (e: ReactMouseEvent) => {
    const next = insertPoint(points, clamp(fromX(local(e).x), 0, 1))
    if (!next) return
    setSelected(next.findIndex((p, i) => p !== points[i]))
    change(next)
  }
  const remove = (index: number) => {
    if (index === 0 || index === points.length - 1) return
    setSelected(null)
    change(removePoint(points, index))
  }

  // The curve itself, sampled the way playback reads it.
  const { line, area } = useMemo(() => {
    let d = ''
    for (let i = 0; i <= 160; i++) {
      const at = i / 160
      d += `${i ? 'L' : 'M'}${toX(at).toFixed(1)} ${toY(speedOnCurve(points, at)).toFixed(1)}`
    }
    return { line: d, area: `${d}L${toX(1)} ${H - PAD}L${toX(0)} ${H - PAD}Z` }
  }, [points])
  const footage = useMemo(() => footageCurve(points, 80), [points])
  const footLine = footage.map((v, i) => `${i ? 'L' : 'M'}${toX(i / 80).toFixed(1)} ${(FOOT_H - 3 - v * (FOOT_H - 6)).toFixed(1)}`).join('')
  const length = curveLength(points, used.current)
  const activePreset = SPEED_RAMPS.find((r) => r.points.length === points.length && r.points.every((p, i) => Math.abs(p.at - points[i].at) < 0.02 && Math.abs(p.speed - points[i].speed) < 0.02))

  // The selected point's handles: the one leading into it (the end of the segment before) and the one leading out.
  const handles =
    sel === null
      ? []
      : ([
          sel > 0 ? { segment: sel - 1, which: 1 as const } : null,
          sel < points.length - 1 ? { segment: sel, which: 0 as const } : null,
        ]
          .filter((h): h is { segment: number; which: 0 | 1 } => h !== null)
          .map((h) => ({ ...h, pos: handlePosition(points, h.segment, h.which) }))
          .filter((h): h is { segment: number; which: 0 | 1; pos: { at: number; speed: number } } => h.pos !== null))
  const pct = (v: number, of: number) => `${(v / of) * 100}%`
  const shapeOf = sel !== null && sel < points.length - 1 ? points[sel].easing : null

  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-4 gap-1">
        {SPEED_RAMPS.map((r) => (
          <button
            key={r.id}
            type="button"
            title={r.description}
            onClick={() => (setSelected(null), change(r.points.map((p) => ({ ...p, easing: 'ease' as const }))))}
            className={cn(
              'h-7 truncate rounded-md px-1 text-2xs font-medium transition-colors',
              activePreset?.id === r.id ? 'bg-accent/18 text-accent-2 shadow-[inset_0_0_0_1px_rgb(214_238_0/0.4)]' : 'bg-white/[0.04] text-fg-3 hover:bg-white/[0.07] hover:text-fg',
            )}
          >
            {r.name}
          </button>
        ))}
        <button
          type="button"
          disabled={!ramped}
          onClick={() => (setSelected(null), dispatch('clip.setSpeedRamp', { id: clip.id, points: null }))}
          className="h-7 rounded-md bg-white/[0.04] px-1 text-2xs font-medium text-fg-3 transition-colors hover:bg-white/[0.07] hover:text-fg disabled:opacity-40"
        >
          {tt('No ramp')}
        </button>
      </div>

      <div data-speed-curve className="relative overflow-hidden rounded-lg bg-black/30 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.06)]" onPointerDown={() => setSelected(null)}>
        <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="block w-full touch-none select-none" style={{ aspectRatio: `${W} / ${H}` }} preserveAspectRatio="none" onDoubleClick={addAt}>
          {GRID.map((s) => (
            <line key={s} x1={PAD} x2={W - PAD} y1={toY(s)} y2={toY(s)} stroke="white" strokeOpacity={s === 1 ? 0.18 : 0.06} strokeDasharray={s === 1 ? undefined : '2 3'} vectorEffect="non-scaling-stroke" />
          ))}
          <path d={area} fill="var(--color-accent)" fillOpacity={0.08} />
          <path d={line} fill="none" stroke="var(--color-accent)" strokeWidth={1.75} vectorEffect="non-scaling-stroke" />
          {sel !== null &&
            handles.map((h) => (
              <line
                key={`${h.segment}:${h.which}`}
                x1={toX(points[h.which === 0 ? h.segment : h.segment + 1].at)}
                y1={toY(points[h.which === 0 ? h.segment : h.segment + 1].speed)}
                x2={toX(h.pos.at)}
                y2={toY(h.pos.speed)}
                stroke="white"
                strokeOpacity={0.55}
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            ))}
        </svg>
        {/* Points and handles as HTML so they stay round whatever the panel width. */}
        {handles.map((h) => (
          <span
            key={`${h.segment}:${h.which}`}
            data-curve-handle={`${h.segment}:${h.which}`}
            onPointerDown={(e) => dragHandleOf(e, h.segment, h.which)}
            title={tt('Drag to shape the curve')}
            className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-[3px] bg-white shadow-[0_1px_4px_rgb(0_0_0/0.6)] transition-transform hover:scale-125 active:cursor-grabbing"
            style={{ left: pct(toX(h.pos.at), W), top: pct(toY(h.pos.speed), H) }}
          />
        ))}
        {points.map((p, i) => (
          <span
            key={i}
            data-curve-point={i}
            onPointerDown={(e) => dragPoint(e, i)}
            onDoubleClick={(e) => (e.stopPropagation(), remove(i))}
            title={`${round(p.speed)}×`}
            className={cn(
              'absolute size-3 -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-full border-2 border-accent bg-surface shadow-[0_1px_4px_rgb(0_0_0/0.6)] transition-transform hover:scale-125 active:cursor-grabbing',
              sel === i && 'scale-125 bg-accent',
            )}
            style={{ left: pct(toX(p.at), W), top: pct(toY(p.speed), H) }}
          />
        ))}
        <div className="pointer-events-none absolute top-1 right-1.5 flex flex-col items-end font-mono text-[9px] leading-tight text-fg-4">
          <span>{ttx('{0}× max', round(Math.max(...points.map((p) => p.speed))))}</span>
          <span>{ttx('{0}× min', round(Math.min(...points.map((p) => p.speed))))}</span>
        </div>
        {/* Time remapping: how much of the footage has played by each moment. */}
        <svg viewBox={`0 0 ${W} ${FOOT_H}`} className="block w-full border-t border-white/[0.06]" style={{ aspectRatio: `${W} / ${FOOT_H}` }} preserveAspectRatio="none" aria-label={tt('How much of the footage has played over the clip')}>
          <line x1={toX(0)} y1={FOOT_H - 3} x2={toX(1)} y2={3} stroke="white" strokeOpacity={0.12} strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
          <path d={footLine} fill="none" stroke="var(--color-snap)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        </svg>
        <span className="pointer-events-none absolute bottom-1 left-2 text-[9px] leading-none text-fg-4">{tt('Footage played')}</span>
      </div>

      {sel !== null && (
        <div className="space-y-2 rounded-lg bg-white/[0.03] p-2 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.04)]">
          <div className="flex items-center gap-2">
            <span className="w-12 shrink-0 text-2xs text-fg-4">{ttx('Point {0}', sel + 1)}</span>
            <ScrubInput aria-label={tt('Speed at this point')} value={points[sel].speed} min={MIN_SPEED} max={MAX_SPEED} step={0.05} precision={2} unit="×" className="w-[72px]" onChange={(v) => change(movePoint(points, sel, points[sel].at, v), `ramp-speed:${clip.id}:${sel}`)} />
            <ScrubInput
              aria-label={tt('Where along the clip')}
              value={Math.round(points[sel].at * 100)}
              min={0}
              max={100}
              step={1}
              precision={0}
              unit="%"
              className="w-[64px]"
              disabled={sel === 0 || sel === points.length - 1}
              onChange={(v) => change(movePoint(points, sel, v / 100, points[sel].speed), `ramp-at:${clip.id}:${sel}`)}
            />
            {sel > 0 && sel < points.length - 1 && (
              <button type="button" onClick={() => remove(sel)} className="ml-auto h-6 rounded-md px-2 text-2xs text-fg-3 hover:bg-white/[0.07] hover:text-fg">
                {tt('Remove')}
              </button>
            )}
          </div>
          {shapeOf !== null && (
            <div className="flex items-center gap-1">
              <span className="w-12 shrink-0 text-2xs text-fg-4">{tt('To next')}</span>
              {SEGMENT_SHAPES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  title={s.hint}
                  aria-pressed={shapeOf === s.id}
                  onClick={() => change(shapeSegment(points, sel, s.id))}
                  className={cn('h-6 flex-1 rounded-md text-2xs font-medium transition-colors', shapeOf === s.id ? 'bg-white/[0.12] text-fg' : 'bg-white/[0.04] text-fg-3 hover:bg-white/[0.07] hover:text-fg')}
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <p className="text-2xs text-fg-4">
        {ramped ? (tt('The clip comes out {0} long.', formatDuration(length, fps)) + ' ') : ''}
        {tt('Drag a point to set a speed, and the handles of a selected point to shape the curve · double-click to add or remove a point · it catches at 1× (hold Alt to skip).')}
      </p>
    </div>
  )
}
