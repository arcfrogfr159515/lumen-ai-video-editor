/**
 * Text-based editing: the timeline's speech as words, each tied to the frames
 * it is said in — so deleting words from the script deletes those frames from
 * the film. The script is read off the timeline, never stored: cut, move or
 * undo anything and it follows.
 */
import { PEAKS_PER_SECOND } from './defaults'
import { clipEnd } from './ops'
import { consumed, localForSource } from './timing'
import type { Asset, Clip, Frame, Project } from './types'

export interface ScriptWord {
  /** Its place in the whole script, from 0. */
  index: number
  text: string
  clipId: string
  /** The line it belongs to (index into the script). */
  line: number
  /** The frames it is said in, on the timeline: [start, end). */
  start: Frame
  end: Frame
}

export interface ScriptLine {
  index: number
  clipId: string
  /** Who says it, when the clip or its media says so. */
  speaker?: string
  start: Frame
  end: Frame
  words: ScriptWord[]
  /** A cut runs through the phrase: some of its words are not on the timeline. */
  partial?: boolean
}

// ─── Words ───────────────────────────────────────────────────────────────

const CJK = '\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Hangul}'
const TOKEN = new RegExp(`[${CJK}]|[^\\s${CJK}]+`, 'gu')
const SPOKEN = /[\p{L}\p{N}]/u

/**
 * A phrase as the pieces it is said in: words, or single characters in scripts
 * written without spaces. Punctuation stays with the word it follows.
 */
export function tokenize(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(TOKEN)) {
    const token = m[0]
    if (!SPOKEN.test(token) && out.length) out[out.length - 1] += token
    else out.push(token)
  }
  return out
}

/** How long a word takes to say, relative to its neighbours: its letters, and a breath after it. */
const weight = (token: string) => {
  const spoken = [...token].filter((ch) => SPOKEN.test(ch)).length
  return Math.max(1, spoken) + (/[,.;:!?，。；：！？、…]$/u.test(token) ? 1.5 : 0.4)
}

/** Words compare without case or punctuation. */
export const plain = (word: string) =>
  word
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}']/gu, '')

/** Clips whose speech is in the script: transcribed media that is actually heard, playing forwards. */
function spoken(project: Pick<Project, 'assets'>, clip: Clip): Asset | null {
  if ((clip.kind !== 'video' && clip.kind !== 'audio') || clip.freeze || clip.reverse || clip.sequenceId || !clip.assetId) return null
  if ((clip.kind === 'video' && clip.audio.detached) || clip.audio.volume <= -60) return null
  const asset = project.assets[clip.assetId]
  return asset?.transcript?.length ? asset : null
}

/**
 * What is said on the timeline, word by word, in order. A transcript times
 * phrases, not words: within a phrase the words share out its time by length,
 * which is close enough to click on and to cut at (cuts are then moved to the
 * quietest moment nearby — see `cutRanges`).
 */
export function timelineScript(project: Pick<Project, 'clips' | 'assets' | 'tracks' | 'settings'>): ScriptLine[] {
  const fps = project.settings.fps
  const hidden = new Set(project.tracks.filter((t) => t.muted).map((t) => t.id))
  const lines: Omit<ScriptLine, 'index'>[] = []
  for (const clip of Object.values(project.clips)) {
    if (hidden.has(clip.trackId)) continue
    const asset = spoken(project, clip)
    if (!asset) continue
    const from = clip.inPoint / fps
    const to = (clip.inPoint + consumed(clip)) / fps
    const speaker = clip.speaker?.trim() || undefined
    for (const seg of asset.transcript!) {
      if (seg.end <= from || seg.start >= to || seg.end <= seg.start) continue
      const tokens = tokenize(seg.text)
      if (!tokens.length) continue
      const total = tokens.reduce((n, t) => n + weight(t), 0)
      const words: ScriptWord[] = []
      let cursor = seg.start
      for (const token of tokens) {
        const length = ((seg.end - seg.start) * weight(token)) / total
        const [a, b] = [cursor, cursor + length]
        cursor = b
        // A word belongs to the clip if its middle is in the footage the clip plays.
        const mid = (a + b) / 2
        if (mid < from || mid >= to) continue
        const start = localForSource(clip, Math.max(a, from) * fps)
        const end = localForSource(clip, Math.min(b, to) * fps)
        if (start === null || end === null) continue
        const s = clip.start + Math.round(start)
        const e = Math.min(clipEnd(clip), Math.max(s + 1, clip.start + Math.round(end)))
        words.push({ index: 0, text: token, clipId: clip.id, line: 0, start: s, end: e })
      }
      if (!words.length) continue
      lines.push({ clipId: clip.id, ...(speaker ? { speaker } : {}), start: words[0].start, end: words[words.length - 1].end, words, ...(words.length < tokens.length ? { partial: true } : {}) })
    }
  }
  lines.sort((a, b) => a.start - b.start || a.end - b.end)
  let index = 0
  return lines.map((line, i) => ({ ...line, index: i, words: line.words.map((w) => ({ ...w, index: index++, line: i })) }))
}

export const scriptWords = (lines: readonly ScriptLine[]): ScriptWord[] => lines.flatMap((l) => l.words)

/** The word being said at a frame (or the last one said before it, within the same line). */
export function wordAt(words: readonly ScriptWord[], frame: Frame): ScriptWord | undefined {
  let lo = 0
  let hi = words.length - 1
  let hit = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (words[mid].start <= frame) {
      hit = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return hit >= 0 && frame < words[hit].end ? words[hit] : undefined
}

// ─── Finding words ───────────────────────────────────────────────────────

const FILLERS = new Set(['um', 'umm', 'uhm', 'uh', 'uhh', 'er', 'erm', 'ah', 'eh', 'hm', 'hmm', 'mm', 'mmm', 'mhm', '嗯', '呃', '额', '唔', 'えー', 'あのー', 'euh', 'ehm', 'äh', 'ähm', 'este', 'pues'])

/** Hesitation sounds: the indexes of words that are only that. */
export function fillerWords(words: readonly ScriptWord[]): number[] {
  return words.filter((w) => FILLERS.has(plain(w.text))).map((w) => w.index)
}

/** Words people say twice on purpose. */
const EMPHATIC = new Set(['very', 'really', 'so', 'no', 'yes', 'yeah', 'bye', 'ha', 'haha', 'blah', 'many', 'much', 'far', 'long', 'never', 'again', 'now', '很', '好', '对', '不', '是', '哈'])

/**
 * Stumbles: a word (or a run of up to three) said again straight away — “I
 * I think”, “we went to we went to the”. The first saying is the one to lose;
 * the second is the one the speaker meant. `maxGap` is how many frames may
 * lie between the two sayings for them to count as one breath.
 */
export function repeatedWords(words: readonly ScriptWord[], maxGap = 30): number[] {
  const out = new Set<number>()
  for (let i = 0; i < words.length; i++) {
    for (let run = 3; run >= 1; run--) {
      if (i + run * 2 > words.length) continue
      const first = words.slice(i, i + run)
      const second = words.slice(i + run, i + run * 2)
      // Said in one breath: no more than a moment apart (they may well be in two clips — an earlier cut can run between them).
      const gap = second[0].start - first[first.length - 1].end
      if (gap < 0 || gap > maxGap) continue
      const same = first.every((w, k) => plain(w.text).length > 0 && plain(w.text) === plain(second[k].text))
      // One word twice is often meant (“very very”, “no no”): those are left; longer runs never are.
      if (!same || (run === 1 && EMPHATIC.has(plain(first[0].text)))) continue
      first.forEach((w) => out.add(w.index))
      i += run - 1
      break
    }
  }
  return [...out].sort((a, b) => a - b)
}

/** Every place a phrase is said: runs of word indexes. Case and punctuation don't matter. */
export function findPhrase(words: readonly ScriptWord[], phrase: string): number[][] {
  const want = tokenize(phrase).map(plain).filter(Boolean)
  if (!want.length) return []
  const have = words.map((w) => plain(w.text))
  const out: number[][] = []
  for (let i = 0; i + want.length <= have.length; i++) {
    if (!want.every((w, k) => have[i + k] === w)) continue
    out.push(Array.from({ length: want.length }, (_, k) => words[i + k].index))
    i += want.length - 1
  }
  return out
}

// ─── Cutting ─────────────────────────────────────────────────────────────

/** A pause shorter than this after a word goes with the word when it is cut, so no hole is left in the rhythm. */
const TRAILING_PAUSE = 0.75
/** How far a cut may move to find a quiet moment, in seconds. */
const QUIET_WINDOW = 0.12

/** The quietest moment of a clip's sound near a timeline frame, by its media's waveform (the frame itself when there is none). */
function quietNear(project: Pick<Project, 'assets' | 'settings'>, clip: Clip, frame: Frame, lo: Frame, hi: Frame): Frame {
  const asset = clip.assetId ? project.assets[clip.assetId] : undefined
  const peaks = asset?.peaks
  if (!peaks?.length) return frame
  const fps = project.settings.fps
  const reach = Math.round(QUIET_WINDOW * fps)
  let best = frame
  let least = Infinity
  for (let f = Math.max(lo, frame - reach); f <= Math.min(hi, frame + reach); f++) {
    const local = f - clip.start
    if (local < 0 || local > clip.duration) continue
    // Speed ramps aside, the clip's sound at a frame is its media's at inPoint + local × speed.
    const sec = (clip.inPoint + local * clip.speed) / fps
    const level = peaks[Math.min(peaks.length - 1, Math.max(0, Math.round(sec * PEAKS_PER_SECOND)))] ?? 0
    // Among equally quiet moments, the nearest to where the words put the cut.
    const score = level + Math.abs(f - frame) * 1e-4
    if (score < least) {
      least = score
      best = f
    }
  }
  return best
}

/**
 * The stretches of timeline to take out so that the given words are no longer
 * said: [start, end) in frames, merged where they touch, earliest first. A
 * short pause after a cut word goes with it; each end of a stretch is then
 * moved to the quietest moment nearby, so a cut doesn't clip a syllable.
 */
export function cutRanges(project: Pick<Project, 'clips' | 'assets' | 'settings'>, lines: readonly ScriptLine[], indexes: readonly number[]): [Frame, Frame][] {
  const words = scriptWords(lines)
  const cut = new Set(indexes)
  const fps = project.settings.fps
  const raw: [Frame, Frame, string][] = []
  for (const w of words) {
    if (!cut.has(w.index)) continue
    const next = words[w.index + 1]
    // Up to the next word of the same clip when it follows closely, pause and all.
    const end = next && next.clipId === w.clipId && next.start >= w.end && next.start - w.end <= TRAILING_PAUSE * fps ? next.start : w.end
    raw.push([w.start, end, w.clipId])
  }
  raw.sort((a, b) => a[0] - b[0])
  const merged: [Frame, Frame, string][] = []
  for (const r of raw) {
    const last = merged[merged.length - 1]
    if (last && r[0] <= last[1] && r[2] === last[2]) last[1] = Math.max(last[1], r[1])
    else merged.push([...r])
  }
  const out: [Frame, Frame][] = []
  for (const [a, b, clipId] of merged) {
    const clip = project.clips[clipId]
    if (!clip) continue
    // A cut that starts or ends on the clip's own edge stays there; inside the clip it looks for quiet.
    const start = a <= clip.start ? clip.start : quietNear(project, clip, a, clip.start, b - 1)
    const end = b >= clipEnd(clip) ? clipEnd(clip) : quietNear(project, clip, b, start + 1, clipEnd(clip))
    if (end > start) out.push([start, end])
  }
  // Stretches from clips that play at the same time can overlap: together they are one.
  out.sort((x, y) => x[0] - y[0])
  const joined: [Frame, Frame][] = []
  for (const r of out) {
    const last = joined[joined.length - 1]
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1])
    else joined.push([r[0], r[1]])
  }
  return joined
}

/** The script as plain text, a line per phrase, with who says it when that is known. */
export function scriptText(lines: readonly ScriptLine[]): string {
  let who: string | undefined
  return lines
    .map((line) => {
      const text = line.words.map((w) => w.text).join(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(line.words[0]?.text ?? '') ? '' : ' ')
      const head = line.speaker && line.speaker !== who ? `${line.speaker}: ` : ''
      who = line.speaker
      return head + text
    })
    .join('\n')
}
