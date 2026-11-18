import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('sonner', () => ({ toast: Object.assign(() => {}, { error: () => {}, success: () => {}, loading: () => 1, dismiss: () => {} }) }))

const { addAsset, freshProject } = await import('@/editor/test-helpers')
const { getProject } = await import('@/editor/store')
const { FOOTAGE_TOOLS } = await import('./footage')

const createMulticam = FOOTAGE_TOOLS.find((t) => t.name === 'create_multicam')!
/** What the tool answers a call it can't carry out with. */
const refusal = async (args: Record<string, unknown>) => {
  try {
    await createMulticam.run(args)
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
  throw new Error('It was carried out.')
}

beforeEach(() => {
  freshProject('Cameras')
  addAsset('cam_a', 30)
  addAsset('cam_b', 30)
})

describe('create_multicam, asked without the recordings', () => {
  // What a model sends isn't checked against the schema. The answer was the error the code tripped over —
  // “Cannot read properties of undefined (reading 'map')” — which names nothing the model could put right.
  it('says which argument is missing', async () => {
    const said = await refusal({})
    expect(said).toMatch(/asset_ids/)
    expect(said).not.toMatch(/Cannot read|is not a function/)
  })

  it('says so when they are not a list', async () => {
    for (const given of ['cam_a', null, { a: 'cam_a', b: 'cam_b' }]) {
      const said = await refusal({ asset_ids: given })
      expect(said).toMatch(/asset_ids/)
      expect(said).not.toMatch(/Cannot read|is not a function/)
    }
  })

  it('says a multicam clip needs two when given one', async () => {
    expect(await refusal({ asset_ids: ['cam_a'], sync: 'start' })).toMatch(/asset_ids.*two or more/)
    expect(Object.keys(getProject().sequences ?? {})).toHaveLength(0)
  })

  it('still makes one from two recordings', async () => {
    const made = (await createMulticam.run({ asset_ids: ['cam_a', 'cam_b'], sync: 'start' })) as { timeline_id: string; clip_id: string }
    expect(getProject().sequences?.[made.timeline_id]?.multicam).toBe(true)
    expect(getProject().clips[made.clip_id]?.sequenceId).toBe(made.timeline_id)
  })
})
