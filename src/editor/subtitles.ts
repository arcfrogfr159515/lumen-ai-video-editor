/**
 * Subtitles in and out: SRT and WebVTT files become caption clips on the
 * Captions track, and the captions on the timeline become SRT or VTT files.
 */
import { clipEnd, clipsOnTrack } from './ops'
import { TITLE_PRESETS } from './presets'
import { dispatch, getProject, useEditor } from './store'
import type { AnimPreset, Project, TextStyle } from './types'
import { tt } from '@/lib/i18n'

/** A subtitle cue, in seconds. */
export interface Cue {
  start: number
  end: number
  text: string
}

// 00:00:01,000 (SRT) · 00:00:01.000 / 00:01.000 (VTT) · 1:02:03.5 (lenient)
const TIME = /(?:(\d+):)?(\d{1,2}):(\d{1,2})[,.](\d{1,3})/
const ARROW = /-->/

function seconds(s: string): number | null {
  const m = TIME.exec(s)
  if (!m) return null
  const [, h, mm, ss, ms] = m
  return Number(h ?? 0) * 3600 + Number(mm) * 60 + Number(ss) + Number(ms.padEnd(3, '0')) / 1000
}

const ESCAPES: Record<string, string> = { amp: '&', lt: '<', gt: '>', nbsp: ' ', quot: '"', apos: "'", lrm: '\u200e', rlm: '\u200f' }

/**
 * The escapes in a cue's text, each read once. Read one kind after another, "&amp;" first, the text "&lt;" — written
 * "&amp;lt;" — became "<"; and the ones given by number, or that set a line's direction, were shown as written.
 */
function unescaped(text: string) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] !== '#') return ESCAPES[body.toLowerCase()] ?? whole
    const code = /^#x/i.test(body) ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
    if (code === 160) return ' '
    return code > 0 && code < 0x110000 && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : whole
  })
}

/** Removes VTT/SRT markup (<i>, <b>, <c.x>, <v Speaker>, {\an8}, timestamps) and entities. */
function clean(text: string) {
  return unescaped(
    text
      .replace(/<\d{1,2}:\d{2}[^>]*>/g, '')
      .replace(/<v(?:\.[^\s>]+)?\s+[^>]*>/gi, '')
      .replace(/<\/?[a-z][^>]*>/gi, '')
      .replace(/\{\\[^}]*\}/g, ''),
  )
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n')
}

/**
 * A subtitle file's bytes as text: UTF-8, as nearly all are — or UTF-16 where the file opens with the mark that says
 * so (what Notepad saves as “Unicode”, and several subtitle editors write). Read as UTF-8 all the same, nothing in
 * such a file looked like subtitles any more, and it was refused as not being a subtitle file.
 */
export function subtitleText(bytes: ArrayBuffer): string {
  const b = new Uint8Array(bytes)
  const encoding = b[0] === 0xff && b[1] === 0xfe ? 'utf-16le' : b[0] === 0xfe && b[1] === 0xff ? 'utf-16be' : 'utf-8'
  return new TextDecoder(encoding).decode(b)
}

/** Reads SRT or WebVTT text into cues (sorted, empty ones dropped). */
export function parseSubtitles(text: string): Cue[] {
  const blocks = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split(/\n{2,}/)
  const cues: Cue[] = []
  for (const block of blocks) {
    const lines = block.split('\n')
    const at = lines.findIndex((l) => ARROW.test(l))
    if (at < 0) continue // header, NOTE, STYLE, REGION
    const [a, b] = lines[at].split(ARROW)
    const start = seconds(a)
    const end = seconds(b)
    if (start === null || end === null || end <= start) continue
    const body = clean(lines.slice(at + 1).join('\n'))
    if (body) cues.push({ start, end, text: body })
  }
  return cues.sort((x, y) => x.start - y.start)
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0')

function stamp(s: number, sep: ',' | '.') {
  const ms = Math.max(0, Math.round(s * 1000))
  return `${pad(Math.floor(ms / 3_600_000))}:${pad(Math.floor(ms / 60_000) % 60)}:${pad(Math.floor(ms / 1000) % 60)}${sep}${pad(ms % 1000, 3)}`
}

/**
 * A cue's text as a file can hold it. An empty line ends a cue in both formats: written as it was, a caption with
 * a gap between its lines stopped at the gap, and the rest lay outside any cue.
 */
const held = (text: string) => text.split(/\r\n?|\n/).filter((l) => l.trim()).join('\n')

export function formatSrt(cues: Cue[]) {
  return cues.map((c, i) => `${i + 1}\n${stamp(c.start, ',')} --> ${stamp(c.end, ',')}\n${held(c.text)}\n`).join('\n')
}

/**
 * A caption's text as WebVTT says it. There "&" begins an escape and "<" a tag, and a line with "-->" in it says when
 * a cue shows: written as they were, "a<b then b>a" lost its middle to whoever read the file. (SRT has no escapes.)
 */
const vttText = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function formatVtt(cues: Cue[]) {
  return `WEBVTT\n\n${cues.map((c) => `${stamp(c.start, '.')} --> ${stamp(c.end, '.')}\n${vttText(held(c.text))}\n`).join('\n')}`
}

export type SubtitleFormat = 'srt' | 'vtt'

export const formatCues = (cues: Cue[], format: SubtitleFormat) => (format === 'vtt' ? formatVtt(cues) : formatSrt(cues))

/** The captions on the timeline as cues: text clips on caption tracks (or, failing that, every text clip). */
export function timelineCues(project: Project): Cue[] {
  const fps = project.settings.fps
  const tracks = project.tracks.filter((t) => t.role === 'captions').map((t) => t.id)
  const pool = tracks.length ? tracks.flatMap((id) => clipsOnTrack(project, id)) : Object.values(project.clips)
  return pool
    .filter((c) => c.kind === 'text' && c.text?.content.trim())
    .map((c) => ({ start: c.start / fps, end: clipEnd(c) / fps, text: c.text!.content.trim() }))
    .sort((a, b) => a.start - b.start)
}

/** The timeline's captions between two frames, re-timed so `range[0]` is zero (what an export of that range shows). */
export function cuesInRange(project: Project, range?: [number, number]): Cue[] {
  const cues = timelineCues(project)
  if (!range) return cues
  const fps = project.settings.fps
  const [a, b] = [range[0] / fps, range[1] / fps]
  return cues.filter((c) => c.end > a && c.start < b).map((c) => ({ ...c, start: Math.max(0, c.start - a), end: Math.min(b, c.end) - a }))
}

/** The project with its caption tracks hidden — for exports that ship captions as a file instead of burning them in. */
export function withoutCaptions(project: Project): Project {
  if (!project.tracks.some((t) => t.role === 'captions' && !t.hidden)) return project
  return { ...project, tracks: project.tracks.map((t) => (t.role === 'captions' ? { ...t, hidden: true } : t)) }
}

export interface CaptionLine {
  /** Frames */
  start: number
  end: number
  text: string
}

/**
 * How captions look and move. clean: the classic subtitle (a soft box, a fade).
 * bold: big outlined caps, a few words at a time, popping in — the short-form
 * look. word: one big word at a time, key words in the accent colour. boxed:
 * solid boxes that rise in.
 */
export type CaptionStyle = 'clean' | 'bold' | 'word' | 'boxed'

export interface CaptionStyleSpec {
  id: CaptionStyle
  name: string
  description: string
  /** Words per caption. */
  words: number
  /** Text size as a fraction of the frame's short side. */
  size: number
  /** How far below the centre, as a fraction of the frame's height. */
  y: number
  text: Partial<TextStyle>
  animation: { in: { preset: AnimPreset; duration: number }; out: { preset: AnimPreset; duration: number } }
}

export const CAPTION_STYLES: CaptionStyleSpec[] = [
  {
    id: 'clean',
    name: tt('Clean'),
    description: tt('Classic subtitles: a soft box, a gentle fade'),
    words: 6,
    size: 0.045,
    y: 0.36,
    text: { font: 'sans', weight: 500, background: 'rgba(0,0,0,0.55)', shadow: 0, uppercase: false, outline: null },
    animation: { in: { preset: 'fade', duration: 3 }, out: { preset: 'fade', duration: 3 } },
  },
  {
    id: 'bold',
    name: tt('Bold'),
    description: tt('Big outlined caps, a few words at a time'),
    words: 3,
    size: 0.075,
    y: 0.24,
    text: { font: 'display', weight: 800, background: null, shadow: 0.35, uppercase: true, letterSpacing: -0.01, outline: { color: '#000000', width: 0.09 } },
    animation: { in: { preset: 'pop', duration: 4 }, out: { preset: 'none', duration: 2 } },
  },
  {
    id: 'word',
    name: tt('Word by word'),
    description: tt('One big word at a time, key words in colour'),
    words: 1,
    size: 0.095,
    y: 0.2,
    text: { font: 'archivo', weight: 850, background: null, shadow: 0.3, uppercase: true, letterSpacing: -0.02, outline: { color: '#000000', width: 0.08 } },
    animation: { in: { preset: 'pop', duration: 3 }, out: { preset: 'none', duration: 2 } },
  },
  {
    id: 'boxed',
    name: tt('Boxed'),
    description: tt('Solid boxes that rise in'),
    words: 5,
    size: 0.05,
    y: 0.33,
    text: { font: 'sans', weight: 650, background: '#0d0d0b', shadow: 0, uppercase: false, outline: null },
    animation: { in: { preset: 'rise', duration: 5 }, out: { preset: 'fade', duration: 3 } },
  },
]

export const captionStyle = (id: CaptionStyle | undefined) => CAPTION_STYLES.find((s) => s.id === id) ?? CAPTION_STYLES[0]

/** What ends a phrase, in any script: . ! ? and the marks Chinese and Japanese end theirs with. (Known by . ! ? alone, a phrase that ends in ？ or ！ had no word in the accent colour.) */
const PHRASE_END = /[.!?。！？]$/
const ASKS_OR_EXCLAIMS = /[!?！？]$/

/** Words that carry the line get the accent colour (word-by-word captions): long words, numbers, and the end of a phrase. */
export function keyWord(word: string, last: boolean) {
  const bare = word.replace(/[^\p{L}\p{N}]/gu, '')
  return bare.length >= 7 || /\d/.test(bare) || (last && ASKS_OR_EXCLAIMS.test(word))
}

/**
 * Lays caption clips on a Captions track in the subtitle style (replacing what's
 * there, unless `track` names a fresh track), as one undo step. Returns the ids.
 */
export function layCaptions(
  lines: CaptionLine[],
  opts: { label: string; source: 'user' | 'ai'; size?: number; y?: number; uppercase?: boolean; newTrack?: string; style?: CaptionStyle; accent?: string },
) {
  const project = getProject()
  const fps = project.settings.fps
  const preset = TITLE_PRESETS.find((t) => t.id === 'subtitle') ?? TITLE_PRESETS[0]
  const style = captionStyle(opts.style)
  const size = opts.size ?? Math.round(Math.min(project.settings.width, project.settings.height) * style.size)
  const y = opts.y ?? Math.round(project.settings.height * style.y)
  const accent = opts.accent ?? '#ffd84a'
  const how = { source: opts.source }
  const ids: string[] = []
  const captions = opts.newTrack ? undefined : project.tracks.find((t) => t.role === 'captions')
  // A locked Captions track keeps what it has and takes nothing new. The captions on it couldn't be taken off —
  // and the new ones were put on it all the same, each slid to the nearest free place among the old ones: twice
  // the captions, the new ones at the wrong time.
  if (captions?.locked) throw new Error(tt('{0} is locked', captions.name))
  let trackId = captions?.id ?? null
  useEditor.getState().transaction(opts.label, opts.source, () => {
    if (trackId) {
      const existing = clipsOnTrack(getProject(), trackId).map((c) => c.id)
      if (existing.length) dispatch('clip.delete', { ids: existing }, how)
    } else {
      const res = dispatch('track.add', { kind: 'video', name: opts.newTrack ?? tt('Captions'), index: 0, role: 'captions' }, how)
      trackId = res.ok ? (res.result as string) : null
    }
    if (!trackId) return
    const sorted = [...lines].sort((a, b) => a.start - b.start)
    for (let i = 0; i < sorted.length; i++) {
      const l = sorted[i]
      const next = sorted[i + 1]
      const end = Math.min(next ? next.start : Infinity, Math.max(l.end, l.start + Math.round(fps * 0.5)))
      const res = dispatch(
        'clip.add',
        {
          trackId,
          kind: 'text',
          start: Math.max(0, l.start),
          duration: Math.max(2, end - l.start),
          name: l.text.split('\n')[0],
          patch: {
            text: {
              ...preset.text,
              ...style.text,
              content: l.text,
              size,
              uppercase: opts.uppercase ?? style.text.uppercase ?? false,
              ...(style.id === 'word' && keyWord(l.text, i === sorted.length - 1 || PHRASE_END.test(l.text)) ? { color: accent } : {}),
            },
            transform: { y },
            animation: style.animation,
          },
        },
        how,
      )
      if (res.ok) ids.push(res.result as string)
    }
  })
  return { ids, trackId }
}

/**
 * Brings a subtitle file onto the timeline as caption clips, `offset` seconds in.
 * With `replace`, it takes over the Captions track; otherwise it gets a track of its own.
 */
export function importSubtitles(text: string, opts: { name?: string; offset?: number; replace?: boolean; source?: 'user' | 'ai' } = {}) {
  const cues = parseSubtitles(text)
  if (!cues.length) throw new Error(tt('No subtitles found — is it an .srt or .vtt file?'))
  const fps = getProject().settings.fps
  const offset = opts.offset ?? 0
  const hasCaptions = getProject().tracks.some((t) => t.role === 'captions' && clipsOnTrack(getProject(), t.id).length)
  const lines = cues.map((c) => ({ start: Math.round((c.start + offset) * fps), end: Math.round((c.end + offset) * fps), text: c.text }))
  const res = layCaptions(lines, {
    label: tt('Import subtitles{0}', opts.name ? ` · ${opts.name}` : ''),
    source: opts.source ?? 'user',
    newTrack: hasCaptions && !opts.replace ? (opts.name ? tt('Captions · {0}', opts.name) : tt('Captions 2')) : undefined,
  })
  return { added: res.ids.length, trackId: res.trackId, cues: cues.length }
}
