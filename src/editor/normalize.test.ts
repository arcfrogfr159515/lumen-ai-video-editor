import { isDraft, produce } from 'immer'
import { describe, expect, it } from 'vitest'
import { commands } from './commands'
import { createEmptyProject } from './new-project'
import { normalizeProject, packTrack, syncGroups } from './ops'
import type { Clip, Project } from './types'

/**
 * normalizeProject runs after every command. It used to read every clip through the command's draft, which made a
 * draft of each: an edit cost as much as the project was large. These hold it to what it is for — the same
 * timeline as before — and to leaving alone what it has no reason to touch.
 */

const run = <N extends keyof typeof commands>(p: Project, name: N, input: unknown): Project =>
  produce(p, (draft) => {
    const def = commands[name] as unknown as { input: { parse: (i: unknown) => unknown }; run: (p: Project, i: unknown) => unknown }
    def.run(draft, def.input.parse(input))
    normalizeProject(draft, p)
  })

function timeline(titles: number, main: number) {
  let p = createEmptyProject('Film')
  const titleTrack = p.tracks.find((t) => t.role !== 'main' && t.kind === 'video')!.id
  const mainTrack = p.tracks.find((t) => t.role === 'main')!.id
  for (let i = 0; i < titles; i++) p = run(p, 'clip.add', { id: `t${i}`, trackId: titleTrack, kind: 'text', start: i * 40, duration: 30 })
  for (let i = 0; i < main; i++) p = run(p, 'clip.add', { id: `m${i}`, trackId: mainTrack, kind: 'text', start: i * 1000, duration: 20 + i })
  return { p, titleTrack, mainTrack }
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
    const next = produce(p, (draft) => {
      draft.clips.new = { ...(structuredClone(p.clips.m0) as Clip), id: 'new', trackId: mainTrack, start: 19.5, duration: 10 }
      normalizeProject(draft, p)
    })
    expect(starts(next, 'm').concat(starts(next, 'new'))).toEqual(['m0@0', 'm1@30', 'm2@51', 'new@20'])
  })

  it('a clip the command didn’t change is the very object it was', () => {
    const { p } = timeline(50, 20)
    const next = run(p, 'clip.update', { ids: ['t7'], patch: { name: 'Renamed' } })
    expect(next.clips.t7.name).toBe('Renamed')
    for (const [id, clip] of Object.entries(next.clips)) if (id !== 't7') expect(clip, id).toBe(p.clips[id])
  })

  it('a command that changes no clip and no track leaves both exactly as they were', () => {
    const { p } = timeline(10, 10)
    const next = run(p, 'marker.add', { frame: 12, label: 'here' })
    expect(next.markers).toHaveLength(1)
    expect(next.clips).toBe(p.clips)
    expect(next.tracks).toBe(p.tracks)
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
    packTrack(loose, mainTrack)
    expect(starts(loose, 'm')).toEqual(['m0@0', 'm2@20', 'm1@42'])
    normalizeProject(loose)
    expect(starts(loose, 'm')).toEqual(['m0@0', 'm2@20', 'm1@42'])
  })
})

describe('grouped clips', () => {
  /** A main-track clip and its sound on another track, as Detach audio leaves them. */
  function grouped(pairs: number) {
    const { p, mainTrack } = timeline(0, pairs)
    const audioTrack = p.tracks.find((t) => t.kind === 'audio')!.id
    return {
      mainTrack,
      p: produce(p, (draft) => {
        for (let i = 0; i < pairs; i++) {
          const m = draft.clips[`m${i}`]
          m.groupId = `g${i}`
          draft.clips[`a${i}`] = { ...(structuredClone(p.clips[`m${i}`]) as Clip), id: `a${i}`, trackId: audioTrack, kind: 'audio', groupId: `g${i}`, start: m.start + 3 }
        }
      }),
    }
  }

  it('follow their partner on the main track when it moves, keeping their distance from it', () => {
    const { p } = grouped(4)
    const next = run(p, 'clip.delete', { ids: ['m0'] })
    // m1, m2 and m3 closed up by m0's 20 frames, and each one's sound went with it.
    expect(starts(next, 'm')).toEqual(['m1@0', 'm2@21', 'm3@43'])
    expect(starts(next, 'a').filter((s) => !s.startsWith('a0'))).toEqual(['a1@3', 'a2@24', 'a3@46'])
  })

  it('stay where they are when their partner hasn’t moved', () => {
    const { p } = grouped(4)
    const next = run(p, 'clip.delete', { ids: ['m3'] })
    for (const id of ['a0', 'a1', 'a2']) expect(next.clips[id], id).toBe(p.clips[id])
  })

  it('are found the same way however many there are', () => {
    // 300 pairs: looked for among all the clips for every clip that moved, this took the square of that.
    const { p } = grouped(300)
    const before = performance.now()
    const next = produce(p, (draft) => {
      draft.clips.m0.duration += 7
      normalizeProject(draft, p)
    })
    const took = performance.now() - before
    for (let i = 1; i < 300; i++) expect(next.clips[`a${i}`].start - next.clips[`m${i}`].start, `pair ${i}`).toBe(3)
    expect(next.clips.m1.start).toBe(p.clips.m1.start + 7)
    // Generous: it takes a few milliseconds; the square of 600 clips through drafts took hundreds.
    expect(took).toBeLessThan(1500)
    // And syncGroups alone, on what was already in step, changes nothing.
    expect(produce(next, (draft) => syncGroups(draft, next))).toBe(next)
  })
})
