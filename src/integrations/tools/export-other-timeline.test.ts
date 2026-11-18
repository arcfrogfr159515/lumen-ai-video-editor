import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExportSettings } from '@/engine/export'

vi.mock('sonner', () => ({ toast: Object.assign(() => {}, { error: () => {}, success: () => {}, loading: () => 1, dismiss: () => {} }) }))

/** What the export was asked to render, when it isn't queued. */
const rendered = vi.hoisted(() => ({ settings: [] as unknown[] }))

vi.mock('@/lib/platform', () => ({
  platform: { isMac: false },
  desktop: {
    export: {
      pick: async () => ({ token: 'token', path: 'C:/out/film.wav', folder: false }),
      begin: async () => ({ id: 'handle', path: 'C:/out/film.wav' }),
    },
    files: { reveal: async () => {} },
  },
}))

vi.mock('@/engine/export', async (original) => ({
  ...(await original<typeof import('@/engine/export')>()),
  exportRunning: () => false,
  runExport: async (_project: unknown, settings: unknown, handle: { path: string }) => {
    rendered.settings.push(settings)
    return { path: handle.path, size: 1_000_000 }
  },
}))

const { add, addAsset, freshProject, run } = await import('@/editor/test-helpers')
const { getProject } = await import('@/editor/store')
const { openSequenceId } = await import('@/editor/sequences')
const { useRenderQueue } = await import('@/engine/render-queue')
const { CONTROL_TOOLS } = await import('./control')

const exportVideo = CONTROL_TOOLS.find((t) => t.name === 'export_video')!
const queued = () => useRenderQueue.getState().jobs.at(-1)!.settings

/**
 * A film at 30 frames a second, open, with three seconds on it — and a second timeline of the same project at 60
 * frames a second, ten seconds long (600 of its frames). Returns the second one's id.
 */
function twoTimelines() {
  freshProject('Film')
  addAsset('talk', 60)
  add('Main', 0, 90, { assetId: 'talk' })
  const main = openSequenceId(getProject())
  const other = run('sequence.create', { name: 'Smooth', settings: { fps: 60 } }) as string
  add('Main', 0, 600, { assetId: 'talk' })
  run('sequence.open', { id: main })
  expect(getProject().settings.fps).toBe(30)
  expect(getProject().sequences![other].settings.fps).toBe(60)
  return other
}

describe('exporting a timeline that isn’t the open one, at another frame rate', () => {
  beforeEach(() => {
    useRenderQueue.setState({ jobs: [], active: false })
    rendered.settings = []
  })

  it('renders all of it', async () => {
    const other = twoTimelines()
    await exportVideo.run({ timeline_id: other, format: 'wav', queue: true })
    // Its end was worked out in seconds and counted back in frames of the open timeline: 300, the first half.
    expect(queued().range).toEqual([0, 600])
  })

  it('counts from_seconds and to_seconds in its own frames', async () => {
    const other = twoTimelines()
    await exportVideo.run({ timeline_id: other, format: 'wav', queue: true, from_seconds: 2, to_seconds: 4 })
    expect(queued().range).toEqual([120, 240])
  })

  it('says how long the part it rendered runs', async () => {
    const other = twoTimelines()
    const said = (await exportVideo.run({ timeline_id: other, format: 'wav' })) as { exported: boolean; seconds_of_video: number }
    expect(said.exported).toBe(true)
    expect((rendered.settings[0] as ExportSettings).range).toEqual([0, 600])
    expect(said.seconds_of_video).toBe(10)
  })

  it('still renders the open timeline by its own', async () => {
    twoTimelines()
    await exportVideo.run({ format: 'wav', queue: true })
    expect(queued().range).toEqual([0, 90])
    await exportVideo.run({ format: 'wav', queue: true, from_seconds: 1, to_seconds: 2 })
    expect(queued().range).toEqual([30, 60])
    const said = (await exportVideo.run({ format: 'wav', from_seconds: 1 })) as { seconds_of_video: number }
    expect(said.seconds_of_video).toBe(2)
  })
})
