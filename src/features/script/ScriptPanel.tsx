/**
 * The script: what is said on the timeline, word by word. Click a word to go
 * to it, drag across words (or Shift-click) to select them, press Delete — and
 * the frames they are said in are gone from the film, everything after closing
 * up. The script is read off the timeline, so it follows every edit and undo.
 */
import { Eraser, Repeat2, ScrollText, Trash } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { SearchInput } from '@/components/ui/input'
import { labelCss } from '@/editor/clip-colors'
import { onPlayhead, playback } from '@/editor/playback'
import { untranscribed } from '@/editor/smart'
import { getProject, useEditor } from '@/editor/store'
import { fillerWords, findPhrase, repeatedWords, scriptText, scriptWords, timelineScript, wordAt, type ScriptLine, type ScriptWord } from '@/editor/text-edit'
import type { LabelColor } from '@/editor/types'
import { cutWords } from '@/features/timeline/timeline-actions'
import { cn } from '@/lib/cn'
import { formatDuration, formatTimecode } from '@/lib/time'
import { copyText } from '@/project/text-files'
import { ensureTranscripts } from '@/project/transcribe'
import { tt } from '@/lib/i18n'
import { ttx } from '@/lib/i18n-react'

const SPEAKER_COLORS: LabelColor[] = ['blue', 'orange', 'green', 'purple', 'teal', 'pink', 'yellow', 'red']
const UNSPACED = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u

export function ScriptPanel() {
  const clips = useEditor((s) => s.project.clips)
  const assets = useEditor((s) => s.project.assets)
  const tracks = useEditor((s) => s.project.tracks)
  const settings = useEditor((s) => s.project.settings)
  const fps = settings.fps
  const lines = useMemo(() => timelineScript({ clips, assets, tracks, settings }), [clips, assets, tracks, settings])
  const words = useMemo(() => scriptWords(lines), [lines])
  const pending = useMemo(() => untranscribed({ ...getProject(), clips, assets, tracks }), [clips, assets, tracks])
  const [selection, setSelection] = useState<{ from: number; to: number } | null>(null)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)

  // The words changed under the selection (an edit, an undo): what it pointed at is no longer there.
  useEffect(() => setSelection(null), [lines])

  const selected = useMemo(() => {
    if (!selection) return new Set<number>()
    const [a, b] = [Math.min(selection.from, selection.to), Math.max(selection.from, selection.to)]
    return new Set(words.slice(a, b + 1).map((w) => w.index))
  }, [selection, words])
  const matches = useMemo(() => (query.trim() ? findPhrase(words, query) : []), [words, query])
  const matched = useMemo(() => new Set(matches.flat()), [matches])
  const fillers = useMemo(() => fillerWords(words), [words])
  // Said again within a second: a restart, not a second thought.
  const repeats = useMemo(() => repeatedWords(words, fps), [words, fps])
  const speakers = useMemo(() => [...new Set(lines.map((l) => l.speaker).filter((s): s is string => Boolean(s)))], [lines])

  // The word being said lights up as the playhead passes — written to the page directly, so playback doesn't re-render the script.
  useEffect(() => {
    let last: Element | null = null
    return onPlayhead((frame) => {
      const w = wordAt(words, frame)
      const el = w ? (bodyRef.current?.querySelector(`[data-word="${w.index}"]`) ?? null) : null
      if (el === last) return
      last?.removeAttribute('data-now')
      el?.setAttribute('data-now', '')
      last = el
    })
  }, [words])

  const cut = (indexes: number[], what: string) => {
    if (!indexes.length) return
    const removed = cutWords(indexes, what)
    if (removed) toast.success(what, { description: tt('{0} taken out of the film. Ctrl+Z brings it back.', formatDuration(removed, fps)), duration: 2600 })
    else toast(tt('Nothing to cut there'))
    setSelection(null)
  }
  const deleteSelection = () => cut([...selected], `Delete ${selected.size} word${selected.size === 1 ? '' : 's'}`)

  /** Press on a word: go to it and start a selection; drag to extend it; Shift extends the last one. */
  const onPointerDown = (e: ReactPointerEvent) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-word]')
    if (!el || e.button !== 0) return void setSelection(null)
    const index = Number(el.dataset.word)
    const word = words[index]
    if (!word) return
    bodyRef.current?.focus()
    if (e.shiftKey && selection) setSelection({ from: selection.from, to: index })
    else {
      setSelection({ from: index, to: index })
      playback.pause()
      playback.seek(word.start)
    }
    const move = (ev: PointerEvent) => {
      const over = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>('[data-word]')
      if (over) setSelection((s) => (s ? { from: s.from, to: Number(over.dataset.word) } : s))
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.ctrlKey || e.metaKey) {
      if (e.key.toLowerCase() === 'a' && words.length) {
        e.preventDefault()
        setSelection({ from: 0, to: words.length - 1 })
      }
      return
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selected.size) {
      // The script's own Delete: the timeline's (which would delete selected clips) doesn't see it.
      e.preventDefault()
      deleteSelection()
    } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && selection) {
      e.preventDefault()
      const to = Math.min(words.length - 1, Math.max(0, selection.to + (e.key === 'ArrowRight' ? 1 : -1)))
      setSelection(e.shiftKey ? { from: selection.from, to } : { from: to, to })
      if (!e.shiftKey && words[to]) (playback.pause(), playback.seek(words[to].start))
    } else if (e.key === 'Escape' && selection) {
      e.preventDefault()
      setSelection(null)
    }
  }

  const transcribe = async () => {
    setBusy(true)
    try {
      await ensureTranscripts(pending)
    } finally {
      setBusy(false)
    }
  }

  const selectedFrames = [...selected].reduce((n, i) => n + (words[i] ? words[i].end - words[i].start : 0), 0)

  return (
    <div className="flex h-full min-h-0 flex-col" data-script-panel>
      <div className="shrink-0 space-y-2 px-3 pt-3 pb-2">
        <SearchInput value={query} onChange={setQuery} placeholder={tt('Find words in the script')} aria-label={tt('Find words in the script')} />
        <div className="flex flex-wrap items-center gap-1">
          {query.trim() ? (
            <Button size="xs" variant="secondary" disabled={!matches.length} onClick={() => cut(matches.flat(), `Delete “${query.trim()}” (${matches.length}×)`)} title={tt('Cut every place this is said')}>
              <Trash />{' '}{ttx('Cut {0} match{1}', matches.length, matches.length === 1 ? '' : tt('es'))}
            </Button>
          ) : (
            <>
              <Button size="xs" variant="secondary" disabled={!fillers.length} onClick={() => cut(fillers, `Remove ${fillers.length} hesitation${fillers.length === 1 ? '' : 's'}`)} title={tt('Um, uh, er… — every word that is only a hesitation')}>
                <Eraser />{' '}{ttx('Hesitations {0}', fillers.length || '')}
              </Button>
              <Button size="xs" variant="secondary" disabled={!repeats.length} onClick={() => cut(repeats, 'Remove stumbles')} title={tt('Words said twice in a row: the first saying goes')}>
                <Repeat2 />{' '}{ttx('Stumbles {0}', repeats.length || '')}
              </Button>
            </>
          )}
          <Button size="xs" variant="ghost" className="ml-auto" disabled={!words.length} onClick={() => void copyText(scriptText(lines), 'Script copied')}>
            {tt('Copy')}
          </Button>
        </div>
      </div>

      {pending.length > 0 && (
        <div className="mx-3 mb-2 flex shrink-0 items-center gap-2 rounded-lg bg-white/[0.04] px-2.5 py-2 text-xs text-fg-3">
          <span className="min-w-0 flex-1">
            {ttx('{0} no transcript yet.', pending.length === 1 ? tt('One clip with speech has') : tt('{0} clips with speech have', pending.length))}
          </span>
          <Button size="xs" variant="primary" disabled={busy} onClick={() => void transcribe()}>
            {tt('Transcribe')}
          </Button>
        </div>
      )}

      {words.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
          <span className="grid size-10 place-items-center rounded-xl bg-white/[0.04] text-fg-3">
            <ScrollText className="size-5" />
          </span>
          <div className="text-sm font-medium text-fg-2">{tt('No words on the timeline yet')}</div>
          <p className="text-xs leading-relaxed text-fg-4">{tt('Put a clip of someone talking on the timeline and transcribe it. Its words appear here; deleting words deletes that part of the film.')}</p>
        </div>
      ) : (
        <div
          ref={bodyRef}
          tabIndex={0}
          onPointerDown={onPointerDown}
          onKeyDown={onKeyDown}
          className="min-h-0 flex-1 cursor-text space-y-2.5 overflow-y-auto px-3 pb-3 text-[13px] leading-[1.75] text-fg-2 outline-none select-none"
        >
          {lines.map((line, i) => (
            <Line key={`${line.clipId}:${line.start}`} line={line} fps={fps} head={line.speaker !== lines[i - 1]?.speaker || line.clipId !== lines[i - 1]?.clipId} speakers={speakers} selected={selected} matched={matched} />
          ))}
        </div>
      )}

      <div className="flex h-9 shrink-0 items-center gap-2 border-t border-line px-3 text-2xs text-fg-4">
        {selected.size > 0 ? (
          <>
            <span className="text-fg-3">
              {ttx('{0} word{1} · {2}', selected.size, selected.size === 1 ? '' : 's', formatDuration(selectedFrames, fps))}
            </span>
            <Button size="xs" variant="danger" className="ml-auto" onClick={deleteSelection}>
              <Trash />{' '}{tt('Delete from the film')}
            </Button>
          </>
        ) : (
          <span>
            {ttx('{0} word{1} · click one to go there, drag to select, Delete to cut', words.length, words.length === 1 ? '' : 's')}
          </span>
        )}
      </div>
    </div>
  )
}

function Line({ line, fps, head, speakers, selected, matched }: { line: ScriptLine; fps: number; head: boolean; speakers: string[]; selected: Set<number>; matched: Set<number> }) {
  const color = line.speaker ? labelCss(SPEAKER_COLORS[speakers.indexOf(line.speaker) % SPEAKER_COLORS.length]) : undefined
  return (
    <p className={cn('relative', line.speaker && 'border-l-2 pl-2')} style={color ? { borderColor: color } : undefined}>
      {head && (
        <span className="mb-0.5 block font-mono text-[10px] leading-none text-fg-4 tabular">
          {line.speaker && (
            <span className="mr-1.5 font-sans font-semibold" style={{ color }}>
              {line.speaker}
            </span>
          )}
          {formatTimecode(line.start, fps)}
        </span>
      )}
      {line.words.map((w) => (
        <Word key={w.index} word={w} selected={selected.has(w.index)} matched={matched.has(w.index)} />
      ))}
      {line.partial && (
        <span className="text-fg-4" title={tt('A cut runs through this phrase: some of its words are not on the timeline')}>
          {' '}
          …
        </span>
      )}
    </p>
  )
}

function Word({ word, selected, matched }: { word: ScriptWord; selected: boolean; matched: boolean }) {
  return (
    <>
      <span
        data-word={word.index}
        className={cn(
          'cursor-pointer rounded-[4px] px-[1.5px] py-[1px] transition-colors hover:bg-white/[0.08] data-[now]:text-fg data-[now]:underline data-[now]:decoration-accent data-[now]:decoration-2 data-[now]:underline-offset-4',
          matched && 'bg-snap/25 text-fg',
          selected && 'bg-accent/30 text-fg',
        )}
      >
        {word.text}
      </span>
      {/* Scripts written without spaces are shown without them. */}
      {UNSPACED.test(word.text) ? null : ' '}
    </>
  )
}
