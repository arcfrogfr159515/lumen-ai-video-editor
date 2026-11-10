/**
 * Branch a timeline, change the branch at random, then take every difference
 * back: the two must then play the same. Comparing and merging are checked
 * against each other, on cuts nobody thought to write a test for.
 */
import { describe, expect, it } from 'vitest'
import type { CommandInput, CommandName } from './commands'
import { diffTimelines } from './diff'
import { clipEnd } from './ops'
import { openSequence, openSequenceId } from './sequences'
import { dispatch, getProject } from './store'
import { problems, rng, setUp } from './test-invariants'
// FUZZ_RUNS=300 makes a long hunt of it.
const RUNS = Number(process.env.FUZZ_RUNS) || 8

describe('taking every difference from a branch', () => {
  for (let seed = 1; seed <= RUNS; seed++) {
    it(`leaves the timeline playing what the branch plays (run ${seed})`, () => {
      const r = rng(seed * 104729)
      setUp()
      // A film: shots on the main track, some B-roll and a music bed.
      const track = (name: string) => getProject().tracks.find((t) => t.name === name)!.id
      const ok = <N extends CommandName>(name: N, input: CommandInput<N>) => {
        const res = dispatch(name, input)
        if (!res.ok) throw new Error(`${name}: ${res.error}`)
        return res.result
      }
      let at = 0
      for (let i = 0; i < 8; i++) {
        const duration = r.int(20, 120)
        ok('clip.add', { trackId: track('Main'), kind: 'video', assetId: r.pick(['v1', 'v2']), start: at, duration, inPoint: r.int(0, 900) })
        at += duration
      }
      for (let i = 0; i < 4; i++) ok('clip.add', { trackId: track('Overlay'), kind: 'video', assetId: 'v1', start: r.int(0, at), duration: r.int(10, 60), inPoint: r.int(0, 900) })
      ok('clip.add', { trackId: track('Music'), kind: 'audio', assetId: 'a1', start: 0, duration: Math.min(at, 3000), inPoint: 0 })
      const main = openSequenceId(getProject())
      const branch = ok('sequence.branch', { name: 'Other' }) as string

      // On the branch: a handful of edits that change what plays where.
      const edits = r.int(2, 18)
      for (let i = 0; i < edits; i++) {
        const p = getProject()
        const clips = Object.values(p.clips)
        const total = Math.max(1, ...clips.map(clipEnd))
        const c = r.pick(clips)
        const edit = r.pick(['delete', 'trim', 'remove', 'add', 'move', 'grade', 'split-delete', 'speed', 'overlay', 'take', 'three-point', 'move-any', 'title', 'volume'] as const)
        if (edit === 'delete') dispatch('clip.delete', { ids: [c.id], ripple: r.chance(0.7) })
        else if (edit === 'trim') dispatch('clip.trim', { id: c.id, edge: r.pick(['start', 'end']), frame: r.int(c.start + 1, clipEnd(c) + 20), ripple: true })
        else if (edit === 'remove') {
          const a = r.int(0, total - 1)
          dispatch('timeline.removeRange', { start: a, end: a + r.int(1, 60) })
        } else if (edit === 'add') dispatch('clip.add', { trackId: track(r.pick(['Main', 'Overlay'])), kind: 'video', assetId: 'v2', start: r.int(0, total), duration: r.int(5, 80), inPoint: r.int(0, 600), mode: 'insert' })
        else if (edit === 'move') dispatch('timeline.moveRange', { start: c.start, end: clipEnd(c), to: r.chance(0.5) ? 0 : total })
        else if (edit === 'grade') dispatch('clip.update', { ids: [c.id], patch: { color: { exposure: r.int(-40, 40) } } })
        else if (edit === 'speed') dispatch('clip.update', { ids: [c.id], patch: { speed: r.pick([0.5, 2, 1.5]) } })
        else if (edit === 'overlay') dispatch('clip.add', { trackId: track('Overlay'), kind: 'video', assetId: 'v1', start: r.int(0, total), duration: r.int(5, 80), inPoint: r.int(0, 600) })
        else if (edit === 'take') dispatch('take.add', { clipId: c.id, assetId: c.kind === 'audio' ? 'a2' : 'v3', inPoint: r.int(0, 200), show: true })
        else if (edit === 'three-point') dispatch('timeline.threePointEdit', { assetId: 'v2', trackId: track(r.pick(['Main', 'Overlay'])), at: r.int(0, total), sourceIn: r.int(0, 300), sourceOut: r.int(301, 500), mode: r.pick(['insert', 'overwrite']), useRange: false })
        else if (edit === 'move-any') {
          const a = r.int(0, total - 1)
          const b = Math.min(total, a + r.int(1, 120))
          if (b > a) dispatch('timeline.moveRange', { start: a, end: b, to: r.chance(0.5) ? r.int(0, a) : r.int(b, total) })
        } else if (edit === 'title') dispatch('clip.add', { trackId: track('Titles'), kind: 'text', start: r.int(0, total), duration: r.int(10, 90) })
        else if (edit === 'volume') dispatch('clip.update', { ids: [c.id], patch: { audio: { volume: r.int(-12, 3) } } })
        else {
          dispatch('clip.split', { frame: c.start + Math.floor(c.duration / 2), ids: [c.id] })
          dispatch('clip.delete', { ids: [c.id], ripple: false })
        }
      }

      ok('sequence.open', { id: main })
      const other = () => getProject().sequences![branch]
      const diff = diffTimelines(openSequence(getProject()), other())
      // Last stretch first, so the earlier ones are still where they were found.
      for (const h of [...diff.hunks].reverse()) ok('timeline.mergeFrom', { sequenceId: branch, a: { start: h.a[0], end: h.a[1] }, b: { start: h.b[0], end: h.b[1] } })
      expect(problems(getProject())).toEqual([])
      const left = diffTimelines(openSequence(getProject()), other())
      expect(left.hunks, `seed ${seed}: still differs after taking ${diff.hunks.length} stretches`).toEqual([])
    })
  }
})
