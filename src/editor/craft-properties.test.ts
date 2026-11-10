/**
 * Promises the timeline tools make, checked on random timelines rather than
 * on the few a test writer thinks of: cutting words leaves exactly the other
 * words, a clean-up leaves nothing to clean, cards dragged on the storyboard
 * end up where they were dropped with everything that was over them, and
 * footage counted as used twice is used twice.
 */
import { describe, expect, it } from 'vitest'
import type { CommandInput, CommandName } from './commands'
import { findGaps } from './gaps'
import { clipsOnTrack } from './ops'
import { findReuse, reusedFrames } from './reuse'
import { bedClips, cutSpokenWords } from './smart'
import { dispatch, getProject, useEditor } from './store'
import { cardMoves, sectionMove, storyboard, storyCards } from './storyboard'
import { addAsset, freshProject } from './test-helpers'
import { problems, rng, setUp } from './test-invariants'
import { scriptWords, timelineScript } from './text-edit'
import type { SpeechSegment } from './types'

// FUZZ_RUNS=500 makes a long hunt of it.
const RUNS = Number(process.env.FUZZ_RUNS) || 10

const track = (name: string) => getProject().tracks.find((t) => t.name === name)!.id
function ok<N extends CommandName>(name: N, input: CommandInput<N>) {
  const res = dispatch(name, input)
  if (!res.ok) throw new Error(`${name}: ${res.error}`)
  return res.result
}

// ─── Cutting by the script ───────────────────────────────────────────────

describe('cutting words out of the script', () => {
  for (let seed = 1; seed <= RUNS; seed++) {
    it(`leaves the other words, in order, and nothing else (run ${seed})`, () => {
      const r = rng(seed * 6007)
      freshProject('Script')
      // Phrases with pauses between them; every word its own, so what is left can be told apart.
      const transcript: SpeechSegment[] = []
      let t = r.next() * 2
      let n = 0
      for (let i = r.int(2, 9); i > 0; i--) {
        const count = r.int(1, 9)
        // Speech runs at two to five words a second.
        const length = count * (0.2 + r.next() * 0.3)
        transcript.push({ start: t, end: t + length, text: Array.from({ length: count }, () => `w${n++}${r.chance(0.15) ? ',' : ''}`).join(' ') })
        t += length + r.pick([0.05, 0.3, 0.9, 2])
      }
      const seconds = Math.ceil(t) + 2
      // Sometimes with a waveform, so the cuts go looking for quiet moments.
      const peaks = r.chance(0.6) ? Array.from({ length: seconds * 50 }, () => r.next()) : undefined
      addAsset('talk', seconds, 'audio', { transcript, ...(peaks ? { peaks } : {}) })
      addAsset('bed', 600, 'audio')
      addAsset('pictures', 600)
      const frames = seconds * 30
      ok('clip.add', { trackId: track('Voice'), kind: 'audio', assetId: 'talk', start: 0, duration: frames, inPoint: 0 })
      ok('clip.add', { trackId: track('Music'), kind: 'audio', assetId: 'bed', start: 0, duration: frames, inPoint: 0 })
      ok('clip.add', { trackId: track('Main'), kind: 'video', assetId: 'pictures', start: 0, duration: frames, inPoint: 0 })

      for (let round = 0; round < 3; round++) {
        const before = scriptWords(timelineScript(getProject()))
        if (before.length < 2) break
        const cut = new Set<number>()
        for (let k = r.int(1, Math.max(1, Math.floor(before.length / 3))); k > 0; k--) {
          // Words go singly and in runs.
          const at = r.int(0, before.length - 1)
          for (let j = at; j < Math.min(before.length, at + r.pick([1, 1, 2, 4])); j++) cut.add(j)
        }
        const length = clipsOnTrack(getProject(), track('Voice')).reduce((sum, c) => sum + c.duration, 0)
        const music = clipsOnTrack(getProject(), track('Music'))
        const res = cutSpokenWords([...cut], { source: 'ai' })
        const told = `seed ${seed}, round ${round}: cut ${[...cut].sort((a, b) => a - b).join(',')} of ${before.map((w) => w.text).join(' ')}`
        expect(res.error, told).toBeUndefined()
        const after = scriptWords(timelineScript(getProject()))
        expect(after.map((w) => w.text).join(' '), told).toBe(before.filter((w) => !cut.has(w.index)).map((w) => w.text).join(' '))
        // The picture and the voice are shorter by what was cut, together; the music plays on unbroken (and ends
        // earlier too, unless the last words of the film were cut: then it plays out).
        expect(problems(getProject()), told).toEqual([])
        for (const name of ['Main', 'Voice']) expect(clipsOnTrack(getProject(), track(name)).reduce((sum, c) => sum + c.duration, 0), `${told} (${name})`).toBe(length - res.frames)
        const bed = clipsOnTrack(getProject(), track('Music'))
        expect(bed.map((c) => [c.id, c.start, c.inPoint]), told).toEqual(music.map((c) => [c.id, c.start, c.inPoint]))
        expect(bed[0].duration, told).toBeGreaterThanOrEqual(music[0].duration - res.frames)
      }
    })
  }
})

// ─── Cleaning up ─────────────────────────────────────────────────────────

describe('a clean-up', () => {
  for (let seed = 1; seed <= RUNS; seed++) {
    it(`leaves no holes, no flash clips, and only the slivers it couldn’t fill (run ${seed})`, () => {
      const r = rng(seed * 7477)
      setUp()
      // A timeline with space in it: clips dropped wherever they fit, some only a frame or two long.
      for (let i = r.int(4, 30); i > 0; i--) {
        const name = r.pick(['Overlay', 'Overlay', 'Main', 'Voice', 'Music', 'Titles'])
        const audio = name === 'Voice' || name === 'Music'
        const duration = r.chance(0.2) ? r.int(1, 3) : r.int(4, 150)
        const start = r.int(0, 900)
        if (name === 'Titles') dispatch('clip.add', { trackId: track(name), kind: 'text', start, duration })
        else dispatch('clip.add', { trackId: track(name), kind: audio ? 'audio' : 'video', assetId: audio ? 'a1' : r.pick(['v1', 'v2']), start, duration, inPoint: r.int(0, 600) })
      }
      const flashFrames = r.pick([1, 3, 3, 6])
      const before = getProject()
      const result = ok('timeline.closeGaps', { flashFrames }) as { left: number; holesClosed: number; flashClipsRemoved: number }
      const after = findGaps(getProject(), flashFrames)
      const told = `seed ${seed}: ${JSON.stringify(result)}`
      expect(problems(getProject()), told).toEqual([])
      expect(after.holes, told).toEqual([])
      expect(after.flashClips, told).toEqual([])
      // A sliver that is left is one neither neighbour has the footage to cover.
      expect(after.gaps.filter((g) => g.flash).length, told).toBeLessThanOrEqual(result.left)
      // Nothing that wasn't a flash clip is gone, and a second pass finds nothing more to do.
      const were = findGaps(before, flashFrames).flashClips.map((c) => c.clipId)
      expect(Object.keys(before.clips).filter((id) => !getProject().clips[id]).sort(), told).toEqual(were.sort())
      const again = getProject()
      dispatch('timeline.closeGaps', { flashFrames })
      expect(getProject(), told).toBe(again)
      // One undo step puts the timeline back as it was.
      if (again !== before) useEditor.getState().undo()
      expect(getProject().clips, told).toEqual(before.clips)
    })
  }
})

// ─── The storyboard ──────────────────────────────────────────────────────

describe('cards moved on the storyboard', () => {
  for (let seed = 1; seed <= RUNS; seed++) {
    it(`land where they were dropped, with what was over them (run ${seed})`, () => {
      const r = rng(seed * 9973)
      setUp()
      const count = r.int(3, 10)
      const names = Array.from({ length: count }, (_, i) => `card ${i}`)
      let at = 0
      const starts: number[] = []
      for (const name of names) {
        const duration = r.int(15, 120)
        ok('clip.add', { trackId: track('Main'), kind: 'video', assetId: 'v1', start: at, duration, inPoint: r.int(0, 600), name })
        starts.push(at)
        // B-roll and a title over some cards, wholly within them; a chapter starts at some.
        if (r.chance(0.5) && duration > 12) ok('clip.add', { trackId: track('Overlay'), kind: 'video', assetId: 'v2', start: at + 3, duration: duration - 6, inPoint: 0, name: `over ${name}` })
        if (r.chance(0.3) && duration > 12) ok('clip.add', { trackId: track('Titles'), kind: 'text', start: at + 2, duration: 8, name: `title ${name}` })
        if (r.chance(0.35)) ok('marker.add', { frame: at, kind: 'chapter', label: `chapter ${name}` })
        at += duration
      }
      ok('clip.add', { trackId: track('Music'), kind: 'audio', assetId: 'a1', start: 0, duration: Math.min(at, 3500), inPoint: 0, name: 'bed' })
      const cardOf = (p = getProject()) => new Map(clipsOnTrack(p, track('Main')).map((c) => [c.name, c]))
      /** How far into its card each thing over a card sits, and which card each chapter starts. */
      const riding = () => {
        const cards = cardOf()
        const p = getProject()
        const out: string[] = []
        for (const c of Object.values(p.clips)) {
          const m = /^(over|title) (card \d+)$/.exec(c.name)
          if (m) out.push(`${c.name} +${c.start - cards.get(m[2])!.start} for ${c.duration}`)
        }
        for (const m of p.markers) out.push(`${m.label} +${m.frame - cards.get(m.label.replace('chapter ', ''))!.start}`)
        return out.sort()
      }
      const rode = riding()
      const music = clipsOnTrack(getProject(), track('Music'))

      for (let round = 0; round < 4; round++) {
        const sections = storyboard(getProject())
        const cards = storyCards(sections)
        const order = cards.map((c) => getProject().clips[c.clipId].name)
        let wanted: string[]
        let label: string
        if (sections.length > 1 && r.chance(0.3)) {
          // A whole section, picked up by its heading.
          const section = r.pick(sections)
          const others = sections.filter((s) => s !== section)
          const before = r.chance(0.8) ? r.pick(others) : null
          const move = sectionMove(sections, section.id, before?.id ?? null)
          label = `section “${section.title}” before ${before ? `“${before.title}”` : 'the end'}`
          const moving = section.cards.map((c) => getProject().clips[c.clipId].name)
          const rest = order.filter((n) => !moving.includes(n))
          const where = before ? rest.indexOf(getProject().clips[before.cards[0].clipId].name) : rest.length
          wanted = [...rest.slice(0, where), ...moving, ...rest.slice(where)]
          if (move) ok('timeline.moveRange', { ...move, keepWhole: bedClips(getProject()) })
          else expect(wanted, `seed ${seed}: ${label} was said to need no move`).toEqual(order)
        } else {
          const picked = [...new Set(Array.from({ length: r.int(1, 3) }, () => r.pick(cards)))]
          const ids = picked.map((c) => c.clipId)
          const others = cards.filter((c) => !ids.includes(c.clipId))
          const before = others.length && r.chance(0.85) ? r.pick(others) : null
          label = `${picked.map((c) => getProject().clips[c.clipId].name).join(', ')} before ${before ? getProject().clips[before.clipId].name : 'the end'}`
          const moving = order.filter((n) => picked.some((c) => getProject().clips[c.clipId].name === n))
          const rest = order.filter((n) => !moving.includes(n))
          const where = before ? rest.indexOf(getProject().clips[before.clipId].name) : rest.length
          wanted = [...rest.slice(0, where), ...moving, ...rest.slice(where)]
          for (const move of cardMoves(sections, ids, before?.clipId ?? null)) ok('timeline.moveRange', { ...move, keepWhole: bedClips(getProject()) })
        }
        const told = `seed ${seed}, round ${round}: ${label}; was ${order.join(' | ')}`
        expect(clipsOnTrack(getProject(), track('Main')).map((c) => c.name), told).toEqual(wanted)
        expect(problems(getProject()), told).toEqual([])
        expect(riding(), told).toEqual(rode)
        expect(clipsOnTrack(getProject(), track('Music')), told).toEqual(music)
      }
    })
  }
})

// ─── Footage used twice ──────────────────────────────────────────────────

describe('footage marked as used more than once', () => {
  for (let seed = 1; seed <= RUNS; seed++) {
    it(`is exactly the footage that plays in two clips (run ${seed})`, () => {
      const r = rng(seed * 4409)
      setUp()
      // Clips of two media items, at normal speed (where footage is counted in whole frames), all over the place.
      let at = 0
      for (let i = r.int(2, 14); i > 0; i--) {
        const duration = r.int(5, 200)
        ok('clip.add', { trackId: track('Overlay'), kind: 'video', assetId: r.pick(['v1', 'v1', 'v2']), start: at, duration, inPoint: r.int(0, 700) })
        at += duration + r.int(0, 20)
      }
      const p = getProject()
      const spans = findReuse(p, 1)
      // Frame by frame: how many clips play each frame of each media item.
      const counts = new Map<string, number>()
      for (const c of Object.values(p.clips)) for (let f = c.inPoint; f < c.inPoint + c.duration; f++) counts.set(`${c.assetId}:${f}`, (counts.get(`${c.assetId}:${f}`) ?? 0) + 1)
      const repeats = [...counts.values()].reduce((sum, n) => sum + (n - 1), 0)
      expect(reusedFrames(spans), `seed ${seed}`).toBe(repeats)
      // And each stretch names exactly the clips that play it, where they play it.
      for (const span of spans) {
        expect(span.to, `seed ${seed}`).toBeGreaterThan(span.from)
        const playing = Object.values(p.clips).filter((c) => c.assetId === span.assetId && c.inPoint < span.to && c.inPoint + c.duration > span.from)
        expect(span.uses.map((u) => u.clipId).sort(), `seed ${seed}`).toEqual(playing.map((c) => c.id).sort())
        for (const u of span.uses) {
          const c = p.clips[u.clipId]
          expect([c.inPoint + u.start, c.inPoint + u.end], `seed ${seed}`).toEqual([span.from, span.to])
        }
      }
    })
  }
})
