import { isDraft, produce } from 'immer'
import { describe, expect, it } from 'vitest'
import { commands } from './commands'
import { createEmptyProject } from './new-project'
import { normalizeMoves, normalizeProject, packTrack } from './ops'
import { dispatch, getProject, useEditor } from './store'
import type { Clip, Project } from './types'

/**
 * The timeline's standing rules — the main track packed edge to edge, grouped clips following their partner
 * there — are kept after every command. The store used to keep them by running normalizeProject on the command's
 * draft, which drafted every clip of the project for every edit. It now asks normalizeMoves what has to move, on
 * the plain project. These hold the two to the same answer, and the store to leaving alone what it has no reason
 * to touch.
 */

/** A project as the store leaves it after a command: the command, then whatever has to move. */
const settle = (p: Project, before: Project): Project => {
  const moves = normalizeMoves(p, before)
  return moves.size
    ? produce(p, (draft) => {
        for (const [id, start] of moves) draft.clips[id].start = start
      })
    : p
}

const run = <N extends keyof typeof commands>(p: Project, name: N, input: unknown): Project => {
  const def = commands[name] as unknown as { input: { parse: (i: unknown) => unknown }; run: (p: Project, i: unknown) => unknown }
  return settle(
    produce(p, (draft) => {
      def.run(draft, def.input.parse(input))
    }),
    p,
  )
}

function timeline(titles: number, main: number) {
  let p = createEmptyProject('Film')
  const titleTrack = p.tracks.find((t) => t.role !== 'main' && t.kind === 'video')!.id
  const mainTrack = p.tracks.find((t) => t.role === 'main')!.id
  for (let i = 0; i < titles; i++) p = run(p, 'clip.add', { id: `t${i}`, trackId: titleTrack, kind: 'text', start: i * 40, duration: 30 })
  for (let i = 0; i < main; i++) p = run(p, 'clip.add', { id: `m${i}`, trackId: mainTrack, kind: 'text', start: i * 1000, duration: 20 + i })
  return { p, titleTrack, mainTrack }
}

/** `pairs` main-track clips, each with its sound on another track, as Detach audio leaves them. */
function grouped(pairs: number) {
  const { p, mainTrack } = timeline(0, pairs)
  const audioTrack = p.tracks.find((t) => t.kind === 'audio')!.id
  return {
    mainTrack,
    audioTrack,
    p: produce(p, (draft) => {
      for (let i = 0; i < pairs; i++) {
        const m = draft.clips[`m${i}`]
        m.groupId = `g${i}`
        draft.clips[`a${i}`] = { ...(structuredClone(p.clips[`m${i}`]) as Clip), id: `a${i}`, trackId: audioTrack, kind: 'audio', groupId: `g${i}`, start: m.start + 3 }
      }
    }),
  }
}

const starts = (p: Project, prefix: string) =>
  Object.values(p.clips)
    .filter((c) => c.id.startsWith(prefix))
    .sort((a, b) => a.start - b.start)
    .map((c) => `${c.id}@${c.start}`)

describe('after a command', () => {
  it('the main track is packed edge to edge, in the order the clips were in', () => {
    const { p } = timeline(3, 4)
    expect(starts(p, 'm')).toEqual(['m0@0', 'm1@20', 'm2@41', 'm3@63'])
    // Free tracks are left where their clips were put.
    expect(starts(p, 't')).toEqual(['t0@0', 't1@40', 't2@80'])
  })

  it('a clip put half a frame ahead of another on the main track goes in before it, and the rest close up', () => {
    const { p, mainTrack } = timeline(0, 3)
    // How a command says "before the clip that starts at 20".
    const placed = produce(p, (draft) => {
      draft.clips.new = { ...(structuredClone(p.clips.m0) as Clip), id: 'new', trackId: mainTrack, start: 19.5, duration: 10 }
    })
    const next = settle(placed, p)
    expect(starts(next, 'm').concat(starts(next, 'new'))).toEqual(['m0@0', 'm1@30', 'm2@51', 'new@20'])
  })

  it('a clip the command didn’t change is the very object it was', () => {
    const { p } = timeline(50, 20)
    const next = run(p, 'clip.update', { ids: ['t7'], patch: { name: 'Renamed' } })
    expect(next.clips.t7.name).toBe('Renamed')
    for (const [id, clip] of Object.entries(next.clips)) if (id !== 't7') expect(clip, id).toBe(p.clips[id])
  })

  it('nothing is asked to move when no clip and no track was changed', () => {
    const { p } = timeline(10, 10)
    const next = produce(p, (draft) => {
      draft.markers.push({ id: 'k', frame: 12, label: 'here' } as Project['markers'][number])
    })
    expect(normalizeMoves(next, p).size).toBe(0)
    expect(next.clips).toBe(p.clips)
  })

  it('grouped clips follow their partner on the main track, keeping their distance from it', () => {
    const { p } = grouped(4)
    const next = run(p, 'clip.delete', { ids: ['m0'] })
    // m1, m2 and m3 closed up by m0's 20 frames, and each one's sound went with it.
    expect(starts(next, 'm')).toEqual(['m1@0', 'm2@21', 'm3@43'])
    expect(starts(next, 'a').filter((s) => !s.startsWith('a0'))).toEqual(['a1@3', 'a2@24', 'a3@46'])
  })

  it('grouped clips whose partner hasn’t moved stay the objects they were', () => {
    const { p } = grouped(4)
    const next = run(p, 'clip.delete', { ids: ['m3'] })
    for (const id of ['a0', 'a1', 'a2']) expect(next.clips[id], id).toBe(p.clips[id])
  })
})

describe('what has to move', () => {
  /** A seeded generator: the same projects every run. */
  const random = (seed: number) => () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 2 ** 32
  }

  it('is what normalizeProject moves, whatever was done to the timeline', () => {
    for (let round = 0; round < 60; round++) {
      const next = random(round + 1)
      const pick = <T>(list: T[]) => list[Math.floor(next() * list.length)]
      const { p: before, mainTrack, audioTrack } = grouped(2 + Math.floor(next() * 10))
      const ids = Object.keys(before.clips)
      // Anything a command might leave behind: clips moved, stretched, taken off the main track or put on it,
      // removed, regrouped, or dropped half a frame ahead of another.
      const after = produce(before, (draft) => {
        for (let n = 0; n < 1 + Math.floor(next() * 6); n++) {
          const clip = draft.clips[pick(ids)]
          if (!clip) continue
          const what = Math.floor(next() * 7)
          if (what === 0) clip.start = Math.floor(next() * 400)
          else if (what === 1) clip.duration = 1 + Math.floor(next() * 80)
          else if (what === 2) clip.trackId = pick([mainTrack, audioTrack])
          else if (what === 3) delete draft.clips[clip.id]
          else if (what === 4) clip.groupId = pick(['g0', 'g1', undefined])
          else if (what === 5) clip.start = Math.max(0, clip.start - 0.5)
          else draft.clips[`n${round}-${n}`] = { ...(structuredClone(before.clips[ids[0]]) as Clip), id: `n${round}-${n}`, trackId: mainTrack, start: Math.floor(next() * 200), groupId: pick(['g0', undefined]) }
        }
      })
      const expected = produce(after, (draft) => normalizeProject(draft, before))
      const actual = settle(after, before)
      expect(Object.fromEntries(Object.values(actual.clips).map((c) => [c.id, c.start])), `round ${round}`).toEqual(Object.fromEntries(Object.values(expected.clips).map((c) => [c.id, c.start])))
      // And settled is settled: asked again, nothing has to move.
      expect(normalizeMoves(actual, actual).size, `round ${round}`).toBe(0)
      expect(normalizeMoves(actual).size, `round ${round}`).toBe(0)
    }
  })

  it('is found without the square of the timeline’s length', () => {
    // 300 pairs: looked for among all the clips for every clip that moved, this was 600 × 300 looks through drafts.
    const { p } = grouped(300)
    const grown = produce(p, (draft) => {
      draft.clips.m0.duration += 7
    })
    const started = performance.now()
    const next = settle(grown, p)
    const took = performance.now() - started
    for (let i = 1; i < 300; i++) expect(next.clips[`a${i}`].start - next.clips[`m${i}`].start, `pair ${i}`).toBe(3)
    expect(next.clips.m1.start).toBe(p.clips.m1.start + 7)
    // Generous: it takes a few milliseconds.
    expect(took).toBeLessThan(1000)
  })
})

describe('in the store', () => {
  it('a command and what it makes move are one edit, and one undo', () => {
    useEditor.getState().loadProject(structuredClone(grouped(3).p) as Project)
    const before = getProject()
    const past = useEditor.getState().past.length
    expect(dispatch('clip.delete', { ids: ['m0'] }).ok).toBe(true)
    expect(starts(getProject(), 'm')).toEqual(['m1@0', 'm2@21'])
    expect(getProject().clips.a1.start).toBe(3)
    expect(useEditor.getState().past.length).toBe(past + 1)
    useEditor.getState().undo()
    expect(getProject()).toEqual(before)
    useEditor.getState().redo()
    expect(starts(getProject(), 'm')).toEqual(['m1@0', 'm2@21'])
    expect(getProject().clips.a2.start).toBe(24)
  })

  it('an edit that moves nothing leaves every other clip the object it was', () => {
    useEditor.getState().loadProject(structuredClone(timeline(30, 10).p) as Project)
    const before = getProject()
    expect(dispatch('clip.update', { ids: ['t3'], patch: { name: 'Renamed' } }).ok).toBe(true)
    const after = getProject()
    for (const [id, clip] of Object.entries(after.clips)) if (id !== 't3') expect(clip, id).toBe(before.clips[id])
    expect(dispatch('marker.add', { frame: 5, label: 'here' }).ok).toBe(true)
    expect(getProject().clips).toBe(after.clips)
  })
})

describe('packing a track', () => {
  it('writes only to the clips that have to move', () => {
    const { p, mainTrack } = timeline(0, 5)
    // m2 grows by 5: the two after it move, the two before it and m2 itself keep their place.
    const grown = produce(p, (draft) => {
      draft.clips.m2.duration += 5
      packTrack(draft, mainTrack)
    })
    expect(starts(grown, 'm')).toEqual(['m0@0', 'm1@20', 'm2@41', 'm3@68', 'm4@91'])
    expect(grown.clips.m0).toBe(p.clips.m0)
    expect(grown.clips.m1).toBe(p.clips.m1)
  })

  it('works on a project that isn’t a draft, as when one is opened', () => {
    const { p, mainTrack } = timeline(0, 3)
    const loose = structuredClone(p) as Project
    loose.clips.m1.start = 500
    loose.clips.m2.start = 90
    expect(isDraft(loose)).toBe(false)
    expect([...normalizeMoves(loose)].sort()).toEqual([['m1', 42], ['m2', 20]])
    packTrack(loose, mainTrack)
    expect(starts(loose, 'm')).toEqual(['m0@0', 'm2@20', 'm1@42'])
    normalizeProject(loose)
    expect(starts(loose, 'm')).toEqual(['m0@0', 'm2@20', 'm1@42'])
    expect(normalizeMoves(loose).size).toBe(0)
  })
})
