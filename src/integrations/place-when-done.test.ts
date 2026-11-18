import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Job } from '@shared/integrations'

// No ElevenLabs here: asking for a sound starts a job, and the test ends it when it likes — a render takes minutes.
const made = vi.hoisted(() => ({ n: 0 }))
vi.mock('./store', async (original) => {
  const real = await original<typeof import('./store')>()
  return {
    ...real,
    elevenSfx: async () => {
      const job = { id: `job_${++made.n}`, integration: 'elevenlabs', title: 'Sound effect', status: 'running', progress: -1, startedAt: 0 } as Job
      real.useIntegrations.setState((s) => ({ jobs: { ...s.jobs, [job.id]: job } }))
      return job
    },
  }
})

const { runAgentTool, startAndPlace } = await import('./agent-tools')
const { elevenSfx, useIntegrations } = await import('./store')
const { addAsset, freshProject, run } = await import('@/editor/test-helpers')
const { getProject } = await import('@/editor/store')
const { openSequenceId } = await import('@/editor/sequences')

const settle = () => new Promise((r) => setTimeout(r, 0))
const jobId = () => `job_${made.n}`
/** The job ends, and what it made lands in the open project's media — as it does in the app. */
function finish(assetId: string) {
  addAsset(assetId, 2, 'audio')
  const id = jobId()
  useIntegrations.setState((s) => ({ jobs: { ...s.jobs, [id]: { ...s.jobs[id], status: 'done', progress: 1, assets: [{} as never] } }, imported: { ...s.imported, [id]: [assetId] } }))
}
/** Where the clips of some media are: on the open timeline, and on the ones that aren't open. */
function placed(assetId: string) {
  const p = getProject()
  const starts = (clips: typeof p.clips) => Object.values(clips).filter((c) => c.assetId === assetId).map((c) => c.start)
  return { open: starts(p.clips), elsewhere: Object.values(p.sequences ?? {}).filter((s) => s.id !== openSequenceId(p)).flatMap((s) => starts(s.clips)) }
}
const ask = (args: Record<string, unknown> = {}) => runAgentTool('generate_sound_effect', { prompt: 'a door closing', at_seconds: 2, ...args })
const answer = async (asked: ReturnType<typeof ask>) => (await asked).structuredContent as { clip_id?: string; asset_ids: string[]; note?: string }

beforeEach(() => {
  freshProject('Film')
})

describe('a sound asked for with a place on the timeline', () => {
  it('is put there when it is made', async () => {
    const asked = ask()
    await settle()
    finish('door')
    const res = await answer(asked)
    expect(placed('door')).toEqual({ open: [60], elsewhere: [] })
    expect(res.clip_id).toBe(Object.values(getProject().clips).find((c) => c.assetId === 'door')!.id)
    expect(res.note).toBeUndefined()
  })

  it('is left in the media when another timeline was opened while it was being made', async () => {
    const other = run('sequence.create', { name: 'Teaser', open: false }) as string
    const asked = ask()
    await settle()
    // While it is being made, the user opens another timeline.
    run('sequence.open', { id: other })
    finish('door')
    const res = await answer(asked)
    // It was put on whatever timeline was open by then, at the frame asked for on the first.
    expect(placed('door')).toEqual({ open: [], elsewhere: [] })
    expect(getProject().assets.door).toBeDefined()
    expect(res.clip_id).toBeUndefined()
    expect(res.asset_ids).toEqual(['door'])
    expect(res.note).toMatch(/not placed/i)
  })

  it('is not put on the timeline of another project opened while it was being made', async () => {
    const asked = ask()
    await settle()
    freshProject('Another film')
    finish('door')
    const res = await answer(asked)
    expect(placed('door')).toEqual({ open: [], elsewhere: [] })
    expect(res.clip_id).toBeUndefined()
    expect(res.note).toMatch(/not placed/i)
  })
})

describe('a render started to be dropped on the timeline once it lands', () => {
  it('is dropped where it was asked for', async () => {
    await startAndPlace(() => elevenSfx({ prompt: 'rain' }), 45)
    finish('rain')
    await settle()
    expect(placed('rain')).toEqual({ open: [45], elsewhere: [] })
  })

  it('is left in the media when another timeline is open by then', async () => {
    const other = run('sequence.create', { name: 'Teaser', open: false }) as string
    await startAndPlace(() => elevenSfx({ prompt: 'rain' }), 45)
    run('sequence.open', { id: other })
    finish('rain')
    await settle()
    expect(placed('rain')).toEqual({ open: [], elsewhere: [] })
    expect(getProject().assets.rain).toBeDefined()
  })
})
