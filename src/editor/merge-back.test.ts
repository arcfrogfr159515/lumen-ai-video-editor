/**
 * The other way round from branch-merge.test.ts: on the branch, take back from the timeline it came from the
 * stretches where it differs. What the branch added goes; the two then play the same.
 */
import { describe, expect, it } from 'vitest'
import { diffTimelines } from './diff'
import { clipEnd } from './ops'
import { openSequence, openSequenceId } from './sequences'
import { getProject } from './store'
import { add, addAsset, freshProject, run, spans, trackId } from './test-helpers'
import { problems, rng, setUp } from './test-invariants'

const RUNS = Number(process.env.FUZZ_RUNS) || 8

/** Takes every stretch that differs from the timeline `from` into the open one, last first. Returns how many. */
function takeAllFrom(from: string) {
  const other = () => getProject().sequences![from]
  const diff = diffTimelines(openSequence(getProject()), other())
  for (const h of [...diff.hunks].reverse()) run('timeline.mergeFrom', { sequenceId: from, a: { start: h.a[0], end: h.a[1] }, b: { start: h.b[0], end: h.b[1] } })
  return diff.hunks.length
}

describe('a stretch the branch added, taken back out', () => {
  it('leaves the shot it was put into as it was: nothing of the shot is put in where the stretch was', () => {
    freshProject('Film')
    addAsset('shot', 60)
    addAsset('cutaway', 60)
    add('Main', 0, 300, { assetId: 'shot' })
    add('Overlay', 0, 300, { assetId: 'shot', inPoint: 600 })
    const main = openSequenceId(getProject())
    run('sequence.branch', { name: 'Other' })
    // On the branch a cutaway goes into the middle of the shot: everything is cut at 100 and moves fifty frames on.
    run('timeline.threePointEdit', { assetId: 'cutaway', trackId: trackId('Main'), at: 100, sourceIn: 0, sourceOut: 50, mode: 'insert', useRange: false })
    expect(spans('Main')).toEqual([[0, 100], [100, 150], [150, 350]])
    expect(spans('Overlay')).toEqual([[0, 100], [150, 350]])

    // The one difference: frames 100–150 here, nothing there. In the timeline it came from, the shot runs through
    // that point — and a frame of it was copied in for every clip that does: one more frame on the main track,
    // and on the track above a frame lying over the piece that had just closed up.
    expect(takeAllFrom(main)).toBe(1)
    expect(problems(getProject())).toEqual([])
    expect(spans('Main')).toEqual([[0, 100], [100, 300]])
    expect(spans('Overlay')).toEqual([[0, 100], [100, 300]])
    expect(diffTimelines(openSequence(getProject()), getProject().sequences![main]).hunks).toEqual([])
  })

  for (let seed = 1; seed <= RUNS; seed++) {
    it(`leaves the branch playing what the timeline it came from plays (run ${seed})`, () => {
      const r = rng(seed * 15485863)
      setUp()
      const track = (name: string) => getProject().tracks.find((t) => t.name === name)!.id
      let at = 0
      for (let i = 0; i < 6; i++) {
        const duration = r.int(40, 160)
        run('clip.add', { trackId: track('Main'), kind: 'video', assetId: r.pick(['v1', 'v2']), start: at, duration, inPoint: r.int(0, 900) })
        at += duration
      }
      for (let i = 0; i < 3; i++) run('clip.add', { trackId: track('Overlay'), kind: 'video', assetId: 'v1', start: r.int(0, at), duration: r.int(30, 120), inPoint: r.int(0, 900) })
      run('clip.add', { trackId: track('Music'), kind: 'audio', assetId: 'a1', start: 0, duration: Math.min(at, 3000), inPoint: 0 })
      const main = openSequenceId(getProject())
      run('sequence.branch', { name: 'Other' })
      // On the branch: things put into the middle of what is there.
      for (let i = r.int(1, 5); i > 0; i--) {
        const total = Math.max(1, ...Object.values(getProject().clips).map(clipEnd))
        run('timeline.threePointEdit', { assetId: 'v3', trackId: track(r.pick(['Main', 'Overlay'])), at: r.int(1, total - 1), sourceIn: r.int(0, 100), sourceOut: r.int(101, 200), mode: 'insert', useRange: false })
      }
      const taken = takeAllFrom(main)
      expect(problems(getProject()), `seed ${seed}`).toEqual([])
      expect(diffTimelines(openSequence(getProject()), getProject().sequences![main]).hunks, `seed ${seed}: still differs after taking ${taken} stretches`).toEqual([])
    })
  }
})
