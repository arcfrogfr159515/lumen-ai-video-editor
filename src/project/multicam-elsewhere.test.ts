import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('sonner', () => ({ toast: Object.assign(() => {}, { error: () => {}, success: () => {}, loading: () => 1, dismiss: () => {} }) }))
// No sound is listened to here: the cameras are lined up when the test says so — decoding a few long recordings
// takes a while in the app — and the second camera started a second after the first.
const cameras = vi.hoisted(() => ({ lined: () => {} }))
vi.mock('@/engine/sync', () => ({
  syncByAudio: (assets: unknown[]) =>
    new Promise((resolve) => {
      cameras.lined = () => resolve(assets.map((_, i) => ({ offset: i, confidence: i ? 12 : Infinity })))
    }),
}))

const { multicamFromAssets } = await import('./analysis-actions')
const { getProject } = await import('@/editor/store')
const { addAsset, freshProject, run } = await import('@/editor/test-helpers')
const { openSequenceId } = await import('@/editor/sequences')

const settle = () => new Promise((r) => setTimeout(r, 0))
/** The multicam clips on the open timeline: where each starts. */
const multicams = () => {
  const p = getProject()
  return Object.values(p.clips)
    .filter((c) => c.sequenceId && p.sequences?.[c.sequenceId]?.multicam)
    .map((c) => c.start)
}
const multicamTimelines = () => Object.values(getProject().sequences ?? {}).filter((s) => s.multicam).length

beforeEach(() => {
  freshProject('Concert')
  addAsset('wide', 60)
  addAsset('close', 60)
})

describe('a multicam clip made from cameras lined up by their sound', () => {
  it('is put on the timeline at the place asked for', async () => {
    const asked = multicamFromAssets(['wide', 'close'], { start: 90 })
    await settle()
    cameras.lined()
    const res = await asked
    expect(multicamTimelines()).toBe(1)
    // (On the main track, which packs what is on it: the first clip of an empty timeline starts it.)
    expect(multicams()).toEqual([0])
    expect(res.clipId).toBeTruthy()
    expect(res.unplaced).toBe(false)
  })

  it('is not put on another timeline that was opened while the cameras were being lined up', async () => {
    const film = openSequenceId(getProject())
    const teaser = run('sequence.create', { name: 'Teaser', open: false }) as string
    const asked = multicamFromAssets(['wide', 'close'], { start: 90 })
    await settle()
    // While the cameras are listened to, the user opens the teaser.
    run('sequence.open', { id: teaser })
    cameras.lined()
    const res = await asked
    // The clip was put on whatever timeline was open by then, at the frame asked for on the first.
    expect(multicams()).toEqual([])
    // The cameras are lined up all the same: their timeline is in the project, to be placed where it is wanted.
    expect(multicamTimelines()).toBe(1)
    expect(res.clipId).toBeNull()
    expect(res.unplaced).toBe(true)
    expect(res.sequenceId).toBeTruthy()
    run('sequence.open', { id: film })
    expect(multicams()).toEqual([])
  })
})
