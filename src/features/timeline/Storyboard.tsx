/**
 * Storyboard: the timeline as cards — one per clip of the story track, in
 * sections where chapter markers divide the film. Drag a card (or a whole
 * section by its heading) to reorder; it moves with everything over and under
 * it. The lanes are a keystroke away for the fine work.
 */
import { AudioLines, BookMarked, Film, GripVertical, Image as ImageIcon, Layers, Layers2, StickyNote, Type } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { toast } from 'sonner'
import { ContextContent, ContextItem, ContextRoot, ContextSeparator, ContextTrigger } from '@/components/ui/menu'
import { clipTint } from '@/editor/clip-colors'
import { openTasks } from '@/editor/notes'
import { playback, usePlayback } from '@/editor/playback'
import { bedClips } from '@/editor/smart'
import { dispatch, getProject, useEditor } from '@/editor/store'
import { cardMoves, reorderable, sectionMove, storyboard, storyCards, storyTrack, type StoryCard, type StoryMove, type StorySection } from '@/editor/storyboard'
import { useTimelineView } from '@/editor/timeline-view'
import type { Clip } from '@/editor/types'
import { useUI } from '@/editor/ui-store'
import { FrameCanvas, stripFrame, useFilmstrip } from '@/features/assets/frames'
import { assetThumb } from '@/features/assets/shared'
import { cn } from '@/lib/cn'
import { formatDuration, formatTimecode } from '@/lib/time'
import { CLIP_COLOR } from './model'
import { tt } from '@/lib/i18n'
import { ttx } from '@/lib/i18n-react'

/** What is being dragged, and where it would land. */
type Drag = { kind: 'cards'; ids: string[]; before: string | null | undefined; x: number; y: number } | { kind: 'section'; id: string; before: string | null | undefined; x: number; y: number }

/** Reorders the timeline: every move as one undo step, music beds left whole. */
function applyMoves(moves: StoryMove[], label: string) {
  if (!moves.length) return
  const keepWhole = bedClips(getProject())
  let error: string | undefined
  useEditor.getState().transaction(label, 'user', () => {
    for (const move of moves) {
      const res = dispatch('timeline.moveRange', { ...move, keepWhole })
      if (!res.ok) error = res.error
    }
  })
  if (error) toast.error(error)
}

export function Storyboard() {
  const clips = useEditor((s) => s.project.clips)
  const tracks = useEditor((s) => s.project.tracks)
  const markers = useEditor((s) => s.project.markers)
  const fps = useEditor((s) => s.project.settings.fps)
  const selection = useUI((s) => s.selection)
  const playhead = usePlayback((s) => s.pausedFrame)
  const setView = useTimelineView((s) => s.set)
  const sections = useMemo(() => storyboard({ clips, tracks, markers }), [clips, tracks, markers])
  const cards = useMemo(() => storyCards(sections), [sections])
  const track = useMemo(() => storyTrack({ clips, tracks }), [clips, tracks])
  const canReorder = reorderable(track)
  const [drag, setDrag] = useState<Drag | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const anchor = useRef<string | null>(null)

  const select = (card: StoryCard, e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }) => {
    const ui = useUI.getState()
    if (e.shiftKey && anchor.current) {
      const a = cards.findIndex((c) => c.clipId === anchor.current)
      const b = cards.findIndex((c) => c.clipId === card.clipId)
      if (a >= 0 && b >= 0) return ui.select(cards.slice(Math.min(a, b), Math.max(a, b) + 1).map((c) => c.clipId))
    }
    anchor.current = card.clipId
    if (e.ctrlKey || e.metaKey) return ui.select([card.clipId], 'toggle')
    ui.select([card.clipId])
    playback.pause()
    playback.seek(card.start)
  }

  /** The card the pointer is over, and whether it is past the card's middle. */
  const cardAt = (x: number, y: number): { before: string | null } | undefined => {
    const el = document.elementsFromPoint(x, y).find((n) => (n as HTMLElement).dataset?.cardId) as HTMLElement | undefined
    if (!el) return undefined
    const r = el.getBoundingClientRect()
    const index = cards.findIndex((c) => c.clipId === el.dataset.cardId)
    if (index < 0) return undefined
    return { before: x < r.left + r.width / 2 ? cards[index].clipId : (cards[index + 1]?.clipId ?? null) }
  }
  const sectionAt = (x: number, y: number): { before: string | null } | undefined => {
    const el = document.elementsFromPoint(x, y).find((n) => (n as HTMLElement).dataset?.sectionId) as HTMLElement | undefined
    if (!el) return undefined
    const r = el.getBoundingClientRect()
    const index = sections.findIndex((s) => s.id === el.dataset.sectionId)
    if (index < 0) return undefined
    return { before: y < r.top + r.height / 2 ? sections[index].id : (sections[index + 1]?.id ?? null) }
  }

  const startDrag = (e: ReactPointerEvent, what: { kind: 'cards'; card: StoryCard } | { kind: 'section'; section: StorySection }) => {
    if (e.button !== 0) return
    const origin = { x: e.clientX, y: e.clientY }
    let dragging = false
    let last: PointerEvent | null = null
    let raf = 0
    const show = (ev: PointerEvent) => {
      if (what.kind === 'cards') {
        // Dragging a selected card takes the whole selection; dragging another takes just that one.
        const sel = useUI.getState().selection
        const ids = sel.includes(what.card.clipId) ? cards.filter((c) => sel.includes(c.clipId)).map((c) => c.clipId) : [what.card.clipId]
        setDrag({ kind: 'cards', ids, before: cardAt(ev.clientX, ev.clientY)?.before, x: ev.clientX, y: ev.clientY })
      } else setDrag({ kind: 'section', id: what.section.id, before: sectionAt(ev.clientX, ev.clientY)?.before, x: ev.clientX, y: ev.clientY })
    }
    // Held near the top or bottom edge, the board scrolls, so a card can be taken to a part of the film that is out of sight.
    const scroll = () => {
      raf = 0
      const root = rootRef.current
      if (!root || !last || !dragging) return
      const r = root.getBoundingClientRect()
      const edge = 44
      const dy = last.clientY > r.bottom - edge ? Math.min(18, (last.clientY - (r.bottom - edge)) / 2) : last.clientY < r.top + edge ? -Math.min(18, (r.top + edge - last.clientY) / 2) : 0
      if (!dy) return
      const before = root.scrollTop
      root.scrollTop += dy
      if (root.scrollTop !== before) show(last)
      raf = requestAnimationFrame(scroll)
    }
    const move = (ev: PointerEvent) => {
      if (!dragging && Math.hypot(ev.clientX - origin.x, ev.clientY - origin.y) < 6) return
      if (!canReorder) return
      dragging = true
      last = ev
      document.body.style.cursor = 'grabbing'
      show(ev)
      if (!raf) raf = requestAnimationFrame(scroll)
    }
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      cancelAnimationFrame(raf)
      document.body.style.cursor = ''
      setDrag(null)
      if (!dragging) {
        if (what.kind === 'cards') select(what.card, ev)
        return
      }
      if (what.kind === 'cards') {
        const sel = useUI.getState().selection
        const ids = sel.includes(what.card.clipId) ? cards.filter((c) => sel.includes(c.clipId)).map((c) => c.clipId) : [what.card.clipId]
        const hit = cardAt(ev.clientX, ev.clientY)
        if (!hit) return
        applyMoves(cardMoves(sections, ids, hit.before), ids.length === 1 ? tt('Move a card') : tt('Move {0} cards', ids.length))
        useUI.getState().select(ids)
      } else {
        const hit = sectionAt(ev.clientX, ev.clientY)
        if (!hit) return
        const m = sectionMove(sections, what.section.id, hit.before)
        if (m) applyMoves([m], tt('Move “{0}”', what.section.title || tt('section')))
      }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  /** Alt+arrow: the selected cards one place earlier or later. */
  const nudge = (step: 1 | -1) => {
    const ids = cards.filter((c) => selection.includes(c.clipId)).map((c) => c.clipId)
    if (!ids.length || !canReorder) return
    const rest = cards.filter((c) => !ids.includes(c.clipId))
    const first = cards.findIndex((c) => c.clipId === ids[0])
    // Where the group sits among the others, then one along.
    const at = cards.slice(0, first).filter((c) => !ids.includes(c.clipId)).length + step
    if (at < 0 || at > rest.length) return
    applyMoves(cardMoves(sections, ids, rest[at]?.clipId ?? null), step > 0 ? tt('Move later') : tt('Move earlier'))
  }

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if ((e.target as HTMLElement).closest('input,textarea')) return
    if (e.ctrlKey || e.metaKey) return
    const left = e.key === 'ArrowLeft'
    const right = e.key === 'ArrowRight'
    if (left || right) {
      e.preventDefault()
      if (e.altKey) return nudge(right ? 1 : -1)
      const current = cards.findIndex((c) => selection.includes(c.clipId))
      const next = cards[current < 0 ? 0 : Math.min(cards.length - 1, Math.max(0, current + (right ? 1 : -1)))]
      if (next) select(next, { shiftKey: false, ctrlKey: false, metaKey: false })
    } else if (e.key === 'Enter') {
      e.preventDefault()
      setView({ storyboard: false })
    }
  }

  // Keep the card that is playing in view.
  const current = cards.find((c) => playhead >= c.start && playhead < c.end)?.clipId
  useEffect(() => {
    if (current) rootRef.current?.querySelector(`[data-card-id="${current}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [current])

  const dropBefore = drag?.kind === 'cards' ? drag.before : undefined
  const lastCard = cards[cards.length - 1]?.clipId

  return (
    <div ref={rootRef} data-storyboard tabIndex={0} onKeyDown={onKeyDown} className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pt-2 pb-4">
      {cards.length === 0 ? (
        <div className="grid h-full place-items-center text-center">
          <div>
            <Layers className="mx-auto size-6 text-fg-4" />
            <p className="mt-2 text-sm font-medium text-fg-2">{tt('Nothing on the main track yet')}</p>
            <p className="mt-1 text-xs text-fg-4">{tt('The storyboard shows the clips that tell the story, one card each. Add footage and it appears here.')}</p>
          </div>
        </div>
      ) : (
        sections.map((section, si) => (
          <section key={section.id} data-section-id={section.id} className={cn('relative', si > 0 && 'mt-3')}>
            {drag?.kind === 'section' && drag.before === section.id && <div className="pointer-events-none absolute inset-x-0 -top-2 h-[3px] rounded-full bg-accent shadow-[0_0_8px_var(--color-accent)]" />}
            {section.id !== 'all' && (
              <SectionHeading section={section} fps={fps} canDrag={canReorder && sections.length > 1} dragging={drag?.kind === 'section' && drag.id === section.id} onPointerDown={(e) => startDrag(e, { kind: 'section', section })} />
            )}
            <div className="flex flex-wrap gap-x-2 gap-y-3">
              {section.cards.map((card) => (
                <Card
                  key={card.clipId}
                  card={card}
                  fps={fps}
                  selected={selection.includes(card.clipId)}
                  playing={current === card.clipId}
                  lifted={drag?.kind === 'cards' && drag.ids.includes(card.clipId)}
                  dropBefore={dropBefore === card.clipId}
                  dropAfter={dropBefore === null && card.clipId === lastCard}
                  onPointerDown={(e) => startDrag(e, { kind: 'cards', card })}
                  onOpen={() => (useUI.getState().select([card.clipId]), setView({ storyboard: false }))}
                />
              ))}
              {section.cards.length === 0 && <p className="py-3 text-xs text-fg-4">{tt('No clip starts in this chapter.')}</p>}
            </div>
            {drag?.kind === 'section' && drag.before === null && si === sections.length - 1 && <div className="pointer-events-none absolute inset-x-0 -bottom-2 h-[3px] rounded-full bg-accent shadow-[0_0_8px_var(--color-accent)]" />}
          </section>
        ))
      )}
      {!canReorder && cards.length > 0 && <p className="mt-4 text-xs text-fg-4">{tt('Cards can be reordered on the main track, whose clips sit edge to edge. This timeline has none, so the cards are for looking at.')}</p>}
      {drag && (
        <div className="popover pointer-events-none fixed z-[80] rounded-lg px-2.5 py-1.5 text-xs font-medium text-fg" style={{ left: drag.x + 14, top: drag.y + 14 }}>
          {drag.kind === 'cards' ? (drag.ids.length === 1 ? (clips[drag.ids[0]]?.name ?? tt('Card')) : tt('{0} cards', drag.ids.length)) : (sections.find((s) => s.id === drag.id)?.title ?? tt('Section'))}
        </div>
      )}
    </div>
  )
}

function SectionHeading({ section, fps, canDrag, dragging, onPointerDown }: { section: StorySection; fps: number; canDrag: boolean; dragging: boolean; onPointerDown: (e: ReactPointerEvent) => void }) {
  const [title, setTitle] = useState(section.title)
  useEffect(() => setTitle(section.title), [section.title])
  return (
    <div className={cn('mb-1.5 flex h-7 items-center gap-1.5', dragging && 'opacity-40')}>
      <span
        onPointerDown={canDrag ? onPointerDown : undefined}
        title={canDrag ? tt('Drag to move the whole section') : undefined}
        className={cn('grid size-5 place-items-center rounded text-fg-4 [&_svg]:size-3.5', canDrag ? 'cursor-grab hover:bg-ink/[0.06] hover:text-fg-2 active:cursor-grabbing' : 'opacity-40')}
      >
        <GripVertical />
      </span>
      <BookMarked className="size-3.5 shrink-0 text-snap" />
      {section.markerId ? (
        <input
          value={title}
          aria-label={tt('Chapter title')}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => (title.trim() && title.trim() !== section.title ? dispatch('marker.update', { id: section.markerId!, patch: { label: title.trim() } }) : setTitle(section.title))}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') (setTitle(section.title), e.currentTarget.blur())
          }}
          // As wide as its text, so the count that follows sits beside the title.
          style={{ width: `${Math.max(6, title.length + 2)}ch` }}
          className="h-6 max-w-[60%] rounded bg-transparent px-1 text-sm font-semibold text-fg outline-none hover:bg-ink/[0.04] focus:bg-ink/[0.07] focus:ring-1 focus:ring-accent/60"
        />
      ) : (
        <span className="px-1 text-sm font-semibold text-fg-3">{section.title}</span>
      )}
      <span className="text-2xs text-fg-4 tabular">
        {ttx('{0} card{1} · {2}', section.cards.length, section.cards.length === 1 ? '' : 's', formatDuration(section.end - section.start, fps))}
      </span>
    </div>
  )
}

const KIND_ICON = { video: Film, image: ImageIcon, audio: AudioLines, text: Type, adjustment: Layers } as const

function Card({
  card,
  fps,
  selected,
  playing,
  lifted,
  dropBefore,
  dropAfter,
  onPointerDown,
  onOpen,
}: {
  card: StoryCard
  fps: number
  selected: boolean
  playing: boolean
  lifted: boolean
  dropBefore: boolean
  dropAfter: boolean
  onPointerDown: (e: ReactPointerEvent) => void
  onOpen: () => void
}) {
  const clip = useEditor((s) => s.project.clips[card.clipId]) as Clip | undefined
  const asset = useEditor((s) => (clip?.assetId ? s.project.assets[clip.assetId] : undefined))
  const tint = useEditor((s) => (s.project.clips[card.clipId] ? clipTint(s.project, s.project.clips[card.clipId])?.css : undefined))
  // The picture the clip opens on, from the file's own frames where there are some.
  const strip = useFilmstrip(asset?.kind === 'video' ? asset : undefined)
  if (!clip) return null
  const at = clip.inPoint / fps + 0.1
  const frame = stripFrame(strip, at)
  const poster = asset && asset.kind !== 'audio' ? assetThumb(asset, at) : undefined
  const Icon = KIND_ICON[clip.kind]
  const open = openTasks(clip)
  const color = tint ?? (clip.sequenceId ? 'var(--color-clip-nest)' : CLIP_COLOR[clip.kind])
  return (
    <ContextRoot>
      <ContextTrigger asChild>
        <div
          data-card-id={card.clipId}
          onPointerDown={onPointerDown}
          onDoubleClick={onOpen}
          aria-selected={selected}
          className={cn('group/card relative w-[168px] shrink-0 cursor-grab select-none rounded-[10px] transition-[opacity,transform] active:cursor-grabbing', lifted && 'scale-[0.97] opacity-40')}
        >
          {dropBefore && <span className="pointer-events-none absolute inset-y-0 -left-[6px] w-[3px] rounded-full bg-accent shadow-[0_0_8px_var(--color-accent)]" />}
          {dropAfter && <span className="pointer-events-none absolute inset-y-0 -right-[6px] w-[3px] rounded-full bg-accent shadow-[0_0_8px_var(--color-accent)]" />}
          <div
            className={cn(
              'relative aspect-video overflow-hidden rounded-[10px] bg-surface-3 shadow-[inset_0_0_0_1px_rgb(from_var(--color-ink)_r_g_b/0.06)] transition-shadow',
              selected && 'shadow-[0_0_0_2px_var(--color-accent)]',
              playing && !selected && 'shadow-[0_0_0_1.5px_rgb(from_var(--color-ink)_r_g_b/0.6)]',
            )}
          >
            {frame ? <FrameCanvas frame={frame} className="absolute inset-0" /> : poster ? <img src={poster} alt="" draggable={false} className="h-full w-full object-cover" /> : <span className="grid h-full place-items-center text-fg-4"><Icon className="size-5" /></span>}
            <span className="absolute inset-x-0 top-0 h-[3px]" style={{ background: color }} />
            <span className="absolute top-1.5 left-1.5 rounded-md bg-shade/65 px-1.5 py-0.5 font-mono text-2xs/[inherit] font-semibold text-on-media tabular backdrop-blur-sm">{card.number}</span>
            <span className="absolute right-1.5 bottom-1.5 rounded-md bg-shade/65 px-1.5 py-0.5 font-mono text-2xs/[inherit] text-on-media tabular backdrop-blur-sm">{formatDuration(card.end - card.start, fps)}</span>
            <span className="absolute bottom-1.5 left-1.5 flex items-center gap-1">
              {clip.takes && clip.takes.length > 1 && (
                <span className="flex items-center gap-0.5 rounded bg-shade/65 px-1 py-0.5 text-2xs/[inherit] font-semibold text-on-media tabular">
                  <Layers2 className="size-2.5" /> {clip.takes.length}
                </span>
              )}
              {(clip.note || clip.tasks?.length) && (
                <span className={cn('flex items-center gap-0.5 rounded px-1 py-0.5 text-2xs/[inherit] font-bold tabular', open ? 'bg-warn text-ink-fg' : 'bg-ink/85 text-ink-fg')}>
                  <StickyNote className="size-2.5" /> {open > 0 && open}
                </span>
              )}
            </span>
          </div>
          <div className="mt-1 px-0.5">
            <div className="truncate text-xs font-medium text-fg-2">{clip.kind === 'text' ? (clip.text?.content.replace(/\n/g, ' · ') ?? clip.name) : clip.name}</div>
            <div className="truncate font-mono text-2xs/[inherit] text-fg-4 tabular">{formatTimecode(card.start, fps)}</div>
            {clip.note && <div className="mt-0.5 line-clamp-2 text-2xs leading-snug text-fg-3">{clip.note}</div>}
          </div>
        </div>
      </ContextTrigger>
      <ContextContent>
        <ContextItem onSelect={onOpen}>{tt('Show it in the timeline')}</ContextItem>
        <ContextItem onSelect={() => dispatch('marker.add', { frame: card.start, kind: 'chapter' })}>{tt('Start a chapter here')}</ContextItem>
        <ContextSeparator />
        <ContextItem
          onSelect={() => {
            useUI.getState().select([card.clipId])
            useUI.getState().setRightTab('inspector')
          }}
        >
          {tt('Notes and tasks…')}
        </ContextItem>
        <ContextSeparator />
        <ContextItem
          danger
          shortcut="shift+delete"
          onSelect={() => {
            const res = dispatch('clip.delete', { ids: [card.clipId], ripple: true })
            if (!res.ok) toast(res.error)
          }}
        >
          {tt('Remove the card')}
        </ContextItem>
      </ContextContent>
    </ContextRoot>
  )
}
