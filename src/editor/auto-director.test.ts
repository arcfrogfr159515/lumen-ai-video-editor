import { beforeEach, describe, expect, it } from 'vitest'
import { angleLevels, directCuts, normalizeSignal, planSummary, switchesFor, type AngleSignal, type DirectorCut } from './auto-director'
import { angleTracks } from './sequences'
import { getProject } from './store'
import { addAsset, clip, freshProject, onTrack, run } from './test-helpers'
import { rng } from './test-invariants'

const STEP = 0.1

/** A camera's microphone: loud while its own speaker talks, a murmur of the others otherwise. */
function mic(seconds: number, speaking: [number, number][], bleed: [number, number][] = []): number[] {
  return Array.from({ length: Math.round(seconds / STEP) }, (_, i) => {
    const t = i * STEP
    // A little flutter, so the signal looks like sound rather than a square wave.
    const flutter = 0.04 * Math.sin(i * 1.7)
    if (speaking.some(([a, b]) => t >= a && t < b)) return 0.7 + flutter
    if (bleed.some(([a, b]) => t >= a && t < b)) return 0.16 + flutter / 2
    return 0.03 + Math.abs(flutter) / 4
  })
}

const shots = (cuts: DirectorCut[]) => cuts.map((c) => [c.at, c.angle, c.why])
const angleAt = (cuts: DirectorCut[], t: number) => [...cuts].reverse().find((c) => c.at <= t)!.angle

describe('whatever the cameras hear', () => {
  for (let seed = 1; seed <= (Number(process.env.FUZZ_RUNS) || 25); seed++) {
    it(`the cut is one a person could watch (run ${seed})`, () => {
      const r = rng(seed * 2741)
      const cameras = r.int(2, 4)
      const seconds = r.int(8, 180)
      // A conversation: stretches where one person talks, where two talk over each other, and where nobody does.
      const talk: [number, number][][] = Array.from({ length: cameras }, () => [])
      const solos: { who: number; from: number; to: number }[] = []
      for (let t = 0; t < seconds; ) {
        const length = r.pick([0.4, 1, 2, 4, 7, 12, 25])
        const to = Math.min(seconds, t + length)
        const kind = r.pick(['one', 'one', 'one', 'two', 'none'])
        const who = r.int(0, cameras - 1)
        if (kind !== 'none') talk[who].push([t, to])
        if (kind === 'two') talk[(who + 1) % cameras].push([t, to])
        if (kind === 'one') solos.push({ who, from: t, to })
        t = to
      }
      const angles: AngleSignal[] = talk.map((mine, i) => ({ level: mic(seconds, mine, talk.filter((_, k) => k !== i).flat()) }))
      const minShot = r.pick([1, 2.5, 4])
      const maxShot = r.pick([8, 14, 30])
      const wide = r.chance(0.3) ? r.int(0, cameras - 1) : null
      const reactions = r.chance(0.6)
      const cuts = directCuts(angles, { step: STEP, minShot, maxShot, wide, reactions })
      const told = `seed ${seed}: ${cameras} cameras, ${seconds} s, min ${minShot}, max ${maxShot}, wide ${wide}, reactions ${reactions}: ${JSON.stringify(shots(cuts))}`

      expect(cuts[0], told).toMatchObject({ at: 0, why: 'opening' })
      for (const [i, c] of cuts.entries()) {
        expect(c.angle, told).toBeGreaterThanOrEqual(0)
        expect(c.angle, told).toBeLessThan(cameras)
        if (!i) continue
        // Every cut goes somewhere else, and no shot flashes by — a cutaway to a listener may be a little shorter.
        expect(c.angle, told).not.toBe(cuts[i - 1].angle)
        expect(c.at - cuts[i - 1].at, told).toBeGreaterThanOrEqual(minShot * (c.why === 'reaction' ? 0.6 : 1) - 1e-6)
      }
      // Nor does the last one.
      if (cuts.length > 1) expect(seconds - cuts[cuts.length - 1].at, told).toBeGreaterThanOrEqual(minShot * 0.6 - 1e-6)
      // Someone who has the floor to themselves for a good while is on screen in the thick of it (cutaways aside).
      if (!reactions && wide === null) {
        for (const s of solos) {
          if (s.to - s.from < 2 * minShot + 3) continue
          const others = talk.some((spans, k) => k !== s.who && spans.some(([a, b]) => a < s.to && b > s.from))
          if (others) continue
          expect(angleAt(cuts, s.to - 0.5), `${told}\n  camera ${s.who} talks alone ${s.from}–${s.to}`).toBe(s.who)
        }
      }
    })
  }
})

describe('reading a signal', () => {
  it('judges each camera against itself', () => {
    const quiet = normalizeSignal([...Array(20).fill(0.01), ...Array(20).fill(0.05)], 1)
    const hot = normalizeSignal([...Array(20).fill(0.2), ...Array(20).fill(0.9)], 1)
    // A quiet recording's speech is as much "speaking" as a hot one's.
    expect(quiet[30]).toBeCloseTo(1)
    expect(hot[30]).toBeCloseTo(1)
    expect(quiet[5]).toBe(0)
    expect(normalizeSignal(Array(30).fill(0.4))).toEqual(Array(30).fill(0))
    expect(normalizeSignal([])).toEqual([])
    // Beside a camera that is really being spoken into, a microphone that only hears the room is silence.
    const room = Array.from({ length: 40 }, (_, i) => 0.02 + 0.01 * Math.sin(i))
    expect(normalizeSignal(room, 1).some((v) => v > 0.5)).toBe(true)
    expect(normalizeSignal(room, 1, 0.9)).toEqual(Array(40).fill(0))
  })
})

describe('the auto-director', () => {
  // A talks 0–6 s, B 6–12 s, then A again to 20 s. Each mic hears the other faintly.
  const a: [number, number][] = [
    [0, 6],
    [12, 20],
  ]
  const b: [number, number][] = [[6, 12]]
  const two: AngleSignal[] = [{ level: mic(20, a, b) }, { level: mic(20, b, a) }]

  it('cuts to whoever is speaking, a beat ahead of them', () => {
    const cuts = directCuts(two, { step: STEP, reactions: false })
    expect(shots(cuts)).toEqual([
      [0, 0, 'opening'],
      [5.75, 1, 'speaker'],
      [11.75, 0, 'speaker'],
    ])
  })

  it('cuts on the word with no lead', () => {
    const cuts = directCuts(two, { step: STEP, reactions: false, lead: 0 })
    expect(cuts.map((c) => c.at)).toEqual([0, 6, 12])
  })

  it('never cuts sooner than the shortest shot, and ignores an interjection', () => {
    // B says one word at 3 s (0.3 s long), and takes over at 6.5 s — half a second after A's shot began at 6.
    const quick: AngleSignal[] = [
      { level: mic(20, [[0, 3], [3.3, 6], [6, 6.5]], [[3, 3.3], [6.5, 20]]) },
      { level: mic(20, [[3, 3.3], [6.5, 20]], [[0, 3], [3.3, 6.5]]) },
    ]
    const cuts = directCuts(quick, { step: STEP, reactions: false, lead: 0, minShot: 4 })
    // The interjection at 3 s is not a cut; the takeover at 6.5 s is.
    expect(shots(cuts)).toEqual([
      [0, 0, 'opening'],
      [6.5, 1, 'speaker'],
    ])
    for (let i = 1; i < cuts.length; i++) expect(cuts[i].at - cuts[i - 1].at).toBeGreaterThanOrEqual(4)
    // With a longer shortest shot the same takeover has to wait for it.
    const patient = directCuts(quick, { step: STEP, reactions: false, lead: 0, minShot: 8 })
    expect(patient.map((c) => c.at)).toEqual([0, 8])
  })

  it('goes to the wide shot when everyone talks, and when nobody does', () => {
    // Camera 2 is the wide. A talks 0–5, both 5–9, nobody 9–13, B 13–20.
    const three: AngleSignal[] = [
      { level: mic(20, [[0, 9]], [[13, 20]]) },
      { level: mic(20, [[5, 9], [13, 20]], [[0, 5]]) },
      { level: mic(20, [[0, 9], [13, 20]]) },
    ]
    const cuts = directCuts(three, { step: STEP, wide: 2, reactions: false, lead: 0 })
    expect(angleAt(cuts, 2)).toBe(0)
    expect(angleAt(cuts, 8)).toBe(2)
    expect(cuts.find((c) => c.angle === 2)?.why).toBe('everyone')
    expect(angleAt(cuts, 12.5)).toBe(2)
    expect(angleAt(cuts, 17)).toBe(1)
    // Without a wide shot, crosstalk stays on the louder voice and silence stays where it is.
    const noWide = directCuts(three.slice(0, 2), { step: STEP, reactions: false, lead: 0 })
    expect(noWide.every((c) => c.angle < 2)).toBe(true)
    expect(angleAt(noWide, 11)).toBe(angleAt(noWide, 8.9))
  })

  it('opens on the wide shot when nobody speaks at once', () => {
    const late: AngleSignal[] = [{ level: mic(12, [[4, 12]]) }, { level: mic(12, []) }, { level: mic(12, [[4, 12]]) }]
    const cuts = directCuts(late, { step: STEP, wide: 2, reactions: false, lead: 0 })
    expect(cuts[0]).toEqual({ at: 0, angle: 2, why: 'opening' })
    expect(cuts[1]).toMatchObject({ angle: 0, why: 'speaker' })
    expect(Math.abs(cuts[1].at - 4)).toBeLessThanOrEqual(0.15)
  })

  it('cuts away to a listener when one shot runs long, and comes back', () => {
    // B spoke first, then A talks for 40 seconds.
    const long: AngleSignal[] = [{ level: mic(46, [[6, 46]], [[0, 6]]) }, { level: mic(46, [[0, 6]], [[6, 46]]) }]
    const cuts = directCuts(long, { step: STEP, lead: 0, maxShot: 12 })
    const reactions = cuts.filter((c) => c.why === 'reaction')
    expect(reactions.length).toBeGreaterThanOrEqual(2)
    expect(reactions.every((c) => c.angle === 1)).toBe(true)
    // Every cutaway is followed by a return to the speaker, a couple of seconds later.
    for (const r of reactions) {
      const back = cuts[cuts.indexOf(r) + 1]
      expect(back).toMatchObject({ angle: 0, why: 'speaker' })
      expect(back.at - r.at).toBeGreaterThanOrEqual(1.5)
      expect(back.at - r.at).toBeLessThanOrEqual(3.5)
    }
    // No shot runs much past the longest allowed.
    for (let i = 1; i < cuts.length; i++) expect(cuts[i].at - cuts[i - 1].at).toBeLessThan(12.6)
    expect(directCuts(long, { step: STEP, lead: 0, maxShot: 12, reactions: false })).toHaveLength(2)
  })

  it('lets the picture tip the balance, and decide alone where there is no sound', () => {
    // Both mics pick up the same voice equally; only camera 1's picture moves from 5 s on.
    const level = mic(12, [[0, 12]])
    const moving = Array.from({ length: 120 }, (_, i) => (i >= 50 ? 8 + (i % 3) : 0.5))
    const still = Array.from({ length: 120 }, (_, i) => 0.5 + (i % 2) * 0.1)
    const cuts = directCuts(
      [
        { level, motion: still },
        { level, motion: moving },
      ],
      { step: STEP, reactions: false, lead: 0 },
    )
    expect(angleAt(cuts, 3)).toBe(0)
    expect(angleAt(cuts, 9)).toBe(1)
    // Silent cameras: movement is all there is to go by.
    const silent = directCuts(
      [
        { level: Array(120).fill(0), motion: still },
        { level: Array(120).fill(0), motion: moving },
      ],
      { step: STEP, reactions: false, lead: 0 },
    )
    expect(angleAt(silent, 9)).toBe(1)
  })

  it('stays on someone who talks all the way through, whatever the other microphones overhear', () => {
    // Camera 2's speaker never pauses; the others never speak — their microphones only hear camera 2, fainter.
    const all: [number, number][] = [[0, 30]]
    const cuts = directCuts([{ level: mic(30, [], all) }, { level: mic(30, all) }, { level: mic(30, [], all) }], { step: STEP, reactions: false })
    expect(shots(cuts)).toEqual([[0, 1, 'opening']])
    // The same when they do stop for breath now and then.
    const breaths: [number, number][] = [[0, 9], [9.6, 21], [21.5, 30]]
    expect(shots(directCuts([{ level: mic(30, [], breaths) }, { level: mic(30, breaths) }], { step: STEP, reactions: false }))).toEqual([[0, 1, 'opening']])
  })

  it('makes no cut so near the end that the last shot would flash by', () => {
    // B starts talking a second before the recording ends.
    const cuts = directCuts([{ level: mic(20, [[0, 19]]) }, { level: mic(20, [[19, 20]]) }], { step: STEP, reactions: false })
    expect(shots(cuts)).toEqual([[0, 0, 'opening']])
    // With room for a whole shot, the cut is made.
    const roomy = directCuts([{ level: mic(20, [[0, 16]]) }, { level: mic(20, [[16, 20]]) }], { step: STEP, reactions: false })
    expect(roomy.map((c) => c.angle)).toEqual([0, 1])
    expect(20 - roomy[1].at).toBeGreaterThanOrEqual(2.5)
    // A last shot a little short of a full one is better than never showing who is talking.
    const tight = directCuts([{ level: mic(10, [[0, 4]]) }, { level: mic(10, [[4, 10]]) }], { step: STEP, reactions: false, minShot: 5.5 })
    expect(shots(tight)).toEqual([
      [0, 0, 'opening'],
      [5.5, 1, 'speaker'],
    ])
  })

  it('has nothing to say without cameras or signals', () => {
    expect(directCuts([], { step: STEP })).toEqual([])
    expect(directCuts([{ level: [] }], { step: STEP })).toEqual([])
    expect(directCuts([{ level: mic(5, [[0, 5]]) }], { step: STEP })).toEqual([{ at: 0, angle: 0, why: 'opening' }])
  })

  it('sums a plan up', () => {
    const cuts = directCuts(two, { step: STEP, reactions: false, lead: 0 })
    const s = planSummary(cuts, 20, 2)
    expect(s.cuts).toBe(2)
    expect(s.averageShot).toBeCloseTo(20 / 3)
    expect(s.share.map((x) => Math.round(x * 100))).toEqual([70, 30])
  })
})

describe('on a multicam clip', () => {
  let clipId: string
  let seqId: string

  beforeEach(() => {
    freshProject('Multicam')
    // Two cameras, 20 s each. Camera A's mic: loud 0–10 s; camera B's: loud 10–20 s. 50 peaks a second.
    const peaks = (from: number, to: number) => Array.from({ length: 20 * 50 }, (_, i) => (i / 50 >= from && i / 50 < to ? 0.7 + 0.03 * Math.sin(i) : 0.04))
    addAsset('cam_a', 20, 'video', { peaks: peaks(0, 10) })
    addAsset('cam_b', 20, 'video', { peaks: peaks(10, 20) })
    const made = run('multicam.create', { angles: [{ assetId: 'cam_a', offset: 0 }, { assetId: 'cam_b', offset: 0 }], audio: 0, place: true, start: 0 }) as { clipId: string; sequenceId: string }
    clipId = made.clipId
    seqId = made.sequenceId
  })

  it('reads each camera’s level off its own waveform, lined up on the multicam timeline', () => {
    const seq = getProject().sequences![seqId]
    const { levels, seconds, missing } = angleLevels(getProject(), seq, 0.5)
    expect(seconds).toBe(20)
    expect(missing).toEqual([])
    expect(levels).toHaveLength(2)
    expect(levels[0][4]).toBeGreaterThan(0.6)
    expect(levels[0][30]).toBeLessThan(0.1)
    expect(levels[1][4]).toBeLessThan(0.1)
    expect(levels[1][30]).toBeGreaterThan(0.6)
    // A camera with no waveform is silence, and is named.
    run('asset.update', { id: 'cam_b', patch: { peaks: [] } })
    expect(angleLevels(getProject(), getProject().sequences![seqId], 0.5).missing).toEqual([1])
  })

  it('turns a plan into cuts on the clip, in timeline frames', () => {
    const seq = getProject().sequences![seqId]
    const { levels } = angleLevels(getProject(), seq, STEP)
    const cuts = directCuts(
      levels.map((level) => ({ level })),
      { step: STEP, reactions: false, lead: 0 },
    )
    expect(cuts.map((c) => [c.at, c.angle])).toEqual([
      [0, 0],
      [10, 1],
    ])
    const plan = switchesFor(getProject(), clip(clipId), cuts)
    expect(plan).toEqual([
      { frame: 0, angle: 1, why: 'opening' },
      { frame: 300, angle: 2, why: 'speaker' },
    ])
    // The opening names the clip (a frame on a clip's edge belongs to no clip in particular); the rest find it.
    plan.forEach((s, i) => run('multicam.switch', { frame: s.frame, angle: s.angle, ...(i === 0 ? { clipId } : {}) }))
    const angles = angleTracks(seq).map((t) => t.id)
    expect(onTrack('Main').map((c) => [c.start, c.duration, angles.indexOf(c.angle!)])).toEqual([
      [0, 300, 0],
      [300, 300, 1],
    ])
  })

  it('plans only the part of the multicam timeline a trimmed, re-timed clip plays', () => {
    // The clip starts 6 s in and plays at double speed: it shows seconds 6–20 of the multicam in 7 s.
    run('clip.trim', { id: clipId, edge: 'start', frame: 180 })
    run('clip.update', { ids: [clipId], patch: { speed: 2 } })
    const c = clip(clipId)
    expect(c).toMatchObject({ inPoint: 180, duration: 210 })
    const plan = switchesFor(getProject(), c, [
      { at: 0, angle: 0, why: 'opening' },
      { at: 4, angle: 1, why: 'speaker' },
      { at: 10, angle: 0, why: 'speaker' },
      { at: 30, angle: 1, why: 'speaker' },
    ])
    // The cut at 4 s is before the clip begins: camera 2 is what it opens on. The one at 10 s is 2 s into the clip.
    expect(plan).toEqual([
      { frame: c.start, angle: 2, why: 'speaker' },
      { frame: c.start + 60, angle: 1, why: 'speaker' },
    ])
  })
})
