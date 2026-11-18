import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Asset, Clip, Project } from './types'

// No audio here. Where an asset has speech is what the test says, and listening to it takes until the test says it
// is done — in the app, the seconds it takes to decode a recording the first time.
const sound = vi.hoisted(() => ({ speech: new Map<string, [number, number][]>(), listening: [] as (() => void)[] }))

vi.mock('@/engine/audio-engine', () => ({
  isAudible: (project: Project, clip: Clip) => (clip.kind === 'audio' || clip.kind === 'video') && Boolean(clip.assetId) && !project.tracks.find((t) => t.id === clip.trackId)?.muted,
  loadAudio: (asset: Asset) => new Promise((resolve) => sound.listening.push(() => resolve({ assetId: asset.id }))),
  activeRegions: (buffer: { assetId: string }) => sound.speech.get(buffer.assetId) ?? [],
  isLongAudio: () => false,
  activeRegionsStreamed: async (asset: Asset) => sound.speech.get(asset.id) ?? [],
}))

const { removePauses } = await import('./smart')
const { add, addAsset, freshProject, onTrack, run, spans } = await import('./test-helpers')
const { getProject } = await import('./store')
const { openSequenceId } = await import('./sequences')

const settle = () => new Promise((r) => setTimeout(r, 0))
/** Lets everything being listened to be heard, until nothing is left to listen to. */
async function heard() {
  for (let i = 0; i < 10; i++) {
    await settle()
    if (!sound.listening.length) return
    sound.listening.splice(0).forEach((done) => done())
  }
}

let n = 0
/** A recording: two lines with a pause of a second and a half between them (frames 64–101 of a clip at 30 fps). */
function interview() {
  const id = `talk_${++n}`
  sound.speech.set(id, [
    [0, 2],
    [3.5, 7],
  ])
  addAsset(id, 7, 'audio')
  return id
}

beforeEach(() => {
  freshProject('Film')
  sound.listening.length = 0
})

describe('pauses, found by listening and then taken out', () => {
  it('come out where they were found, when nothing changed meanwhile', async () => {
    add('Voice', 0, 210, { assetId: interview() })
    const asked = removePauses()
    await heard()
    expect(await asked).toMatchObject({ removed: 1 })
    expect(spans('Voice')).toEqual([
      [0, 64],
      [64, 173],
    ])
  })

  it('come out where they are by then, when the clip was moved while it was being listened to', async () => {
    const voice = add('Voice', 0, 210, { assetId: interview() })
    const asked = removePauses()
    await settle()
    // While it listens, the clip is moved three seconds later.
    run('clip.move', { moves: [{ id: voice, start: 90 }] })
    await heard()
    // The frames the pause was at when the listening began were taken out all the same: by then they held the
    // first line's opening words. The pause stayed in.
    expect(await asked).toMatchObject({ removed: 1 })
    expect(spans('Voice')).toEqual([
      [90, 154],
      [154, 263],
    ])
  })

  it('leave the timeline alone when the clip they were in was deleted meanwhile', async () => {
    const voice = add('Voice', 0, 210, { assetId: interview() })
    add('Titles', 105, 45, { kind: 'text', name: 'Chapter two' })
    const asked = removePauses({ clipIds: [voice] })
    await settle()
    run('clip.delete', { ids: [voice] })
    await heard()
    // The frames were taken out of what was left: the title after them moved up.
    expect(await asked).toMatchObject({ removed: 0 })
    expect(spans('Titles')).toEqual([[105, 150]])
  })

  it('come out of no other timeline than the one they were asked for', async () => {
    const film = openSequenceId(getProject())
    add('Voice', 0, 210, { assetId: interview() })
    const teaser = run('sequence.create', { name: 'Teaser', open: true }) as string
    add('Voice', 0, 210, { assetId: interview() })
    run('sequence.open', { id: film })

    const refused = expect(removePauses()).rejects.toThrow('Another timeline was opened while the pauses were being listened for, so nothing was removed.')
    await settle()
    // While it listens, the user opens the teaser.
    run('sequence.open', { id: teaser })
    await heard()
    await refused
    expect(onTrack('Voice').map((c) => [c.start, c.duration])).toEqual([[0, 210]])
    run('sequence.open', { id: film })
    expect(spans('Voice')).toEqual([[0, 210]])
  })
})
