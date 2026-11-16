import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExportTarget } from '@shared/app'
import type { ExportSettings } from './export'

const harness = vi.hoisted(() => {
  class ExportCancelled extends Error {}
  const state = {
    running: false,
    run: (_project: unknown, _settings: unknown, handle: { path: string }, _onProgress: (p: unknown) => void, _signal: AbortSignal): Promise<{ path: string; size: number }> =>
      Promise.resolve({ path: handle.path, size: 4 }),
  }
  const desk = {
    on: false,
    forgotten: [] as string[],
    opened: [] as string[],
    picked: null as ExportTarget | null,
  }
  return { ExportCancelled, state, desk }
})

vi.mock('@/lib/platform', () => ({
  get desktop() {
    if (!harness.desk.on) return null
    return {
      export: {
        open: async (token: string) => {
          harness.desk.opened.push(token)
          return { id: 'handle', path: `C:/out/${token}.mp4`, token }
        },
        forget: async (token: string) => {
          harness.desk.forgotten.push(token)
        },
        pick: async () => harness.desk.picked,
      },
    }
  },
}))

vi.mock('./export', () => ({
  ExportCancelled: harness.ExportCancelled,
  exportRunning: () => harness.state.running,
  runExport: (project: unknown, settings: unknown, handle: { path: string }, onProgress: (p: unknown) => void, signal: AbortSignal) =>
    harness.state.run(project, settings, handle, onProgress, signal),
}))

import { cancelJob, clearFinished, queueCounts, queueExport, removeJob, retryJob, startQueue, stopQueue, useRenderQueue } from './render-queue'

const settings = { format: 'mp4', codec: 'avc', width: 1280, height: 720, fps: 30, quality: 70, hardware: false } as ExportSettings

function add(label: string) {
  return queueExport({
    label,
    detail: 'MP4',
    project: { settings: { fps: 30 } } as never,
    settings,
    target: { token: label, path: `C:/out/${label}.mp4`, folder: false },
  })
}

const statuses = () => useRenderQueue.getState().jobs.map((j) => [j.label, j.status])

describe('the render queue', () => {
  beforeEach(() => {
    useRenderQueue.setState({ jobs: [], active: false })
    harness.desk.on = false
    harness.desk.forgotten = []
    harness.desk.opened = []
    harness.desk.picked = null
    harness.state.running = false
    harness.state.run = (_project, _settings, handle) => Promise.resolve({ path: handle.path, size: 4 })
  })

  it('fails a job that cannot start, and still finishes the rest of the queue', async () => {
    add('one')
    add('two')
    await startQueue()
    expect(statuses()).toEqual([
      ['one', 'failed'],
      ['two', 'failed'],
    ])
    expect(useRenderQueue.getState().jobs.every((j) => j.error)).toBe(true)
    expect(useRenderQueue.getState().active).toBe(false)
    expect(harness.desk.opened).toEqual([])
  })

  it('renders queued jobs one after another, and stopping lets the current one finish', async () => {
    harness.desk.on = true
    let release: (() => void) | null = null
    const order: string[] = []
    harness.state.run = (_project, _settings, handle, onProgress) =>
      new Promise((resolve) => {
        order.push(handle.path)
        onProgress({ phase: 'rendering', done: 1, total: 4, speed: 1, eta: 1, message: '25%' })
        release = () => resolve({ path: handle.path, size: 20 })
      })
    add('one')
    add('two')
    const done = startQueue()
    await vi.waitFor(() => expect(useRenderQueue.getState().jobs[0].status).toBe('running'))
    expect(useRenderQueue.getState().jobs[1].status).toBe('queued')
    expect(useRenderQueue.getState().jobs[0].progress).toBe(0.25)
    stopQueue(false)
    release!()
    await done
    expect(order).toEqual(['C:/out/one.mp4'])
    expect(statuses()).toEqual([
      ['one', 'done'],
      ['two', 'queued'],
    ])
    expect(useRenderQueue.getState().active).toBe(false)
  })

  it('cancels a waiting job and forgets its file, and leaves a job that is rendering', async () => {
    harness.desk.on = true
    const waiting = add('wait')
    cancelJob(waiting.id)
    expect(statuses()).toEqual([['wait', 'cancelled']])
    expect(harness.desk.forgotten).toEqual(['wait'])

    harness.desk.on = true
    const held = add('held')
    let signal: AbortSignal | null = null
    harness.state.run = (_project, _settings, _handle, _onProgress, s) =>
      new Promise((_resolve, reject) => {
        signal = s
        s.addEventListener('abort', () => reject(new harness.ExportCancelled()))
      })
    const done = startQueue()
    await vi.waitFor(() => expect(useRenderQueue.getState().jobs.find((j) => j.id === held.id)?.status).toBe('running'))
    removeJob(held.id)
    expect(useRenderQueue.getState().jobs.some((j) => j.id === held.id)).toBe(true)
    cancelJob(held.id)
    expect(signal!.aborted).toBe(true)
    await done
    expect(useRenderQueue.getState().jobs.find((j) => j.id === held.id)?.status).toBe('cancelled')
  })

  it('forgets a waiting job that is removed, and clear only drops ones that finished', () => {
    harness.desk.on = true
    const waiting = add('wait')
    const failed = add('bad')
    const done = add('ok')
    const cancelled = add('no')
    useRenderQueue.setState({
      jobs: useRenderQueue.getState().jobs.map((j) => (j.id === failed.id ? { ...j, status: 'failed' as const, error: 'disk full' } : j.id === done.id ? { ...j, status: 'done' as const } : j.id === cancelled.id ? { ...j, status: 'cancelled' as const } : j)),
    })
    removeJob(waiting.id)
    expect(harness.desk.forgotten).toEqual(['wait'])
    clearFinished()
    expect(useRenderQueue.getState().jobs.map((j) => j.label)).toEqual(['bad', 'no'])
    expect(queueCounts(useRenderQueue.getState().jobs)).toMatchObject({ queued: 0, done: 0, failed: 1, running: null })
  })

  it('retries onto a newly chosen file, and leaves the job alone when none is chosen', async () => {
    harness.desk.on = true
    const job = add('bad')
    useRenderQueue.setState({ jobs: [{ ...useRenderQueue.getState().jobs[0], status: 'failed', error: 'disk full' }] })
    expect(await retryJob(job.id)).toBe(false)
    expect(useRenderQueue.getState().jobs[0].status).toBe('failed')
    harness.desk.picked = { token: 'again', path: 'D:/films/bad.mp4', folder: false }
    expect(await retryJob(job.id)).toBe(true)
    expect(useRenderQueue.getState().jobs[0]).toMatchObject({ status: 'queued', error: undefined, target: harness.desk.picked, progress: 0 })
  })

  it('waits while another export is already running, instead of starting a second one', async () => {
    vi.useFakeTimers()
    harness.desk.on = true
    harness.state.running = true
    add('later')
    const done = startQueue()
    await vi.advanceTimersByTimeAsync(1000)
    expect(harness.desk.opened).toEqual([])
    expect(useRenderQueue.getState().jobs[0].status).toBe('queued')
    harness.state.running = false
    await vi.advanceTimersByTimeAsync(1000)
    await done
    expect(harness.desk.opened).toEqual(['later'])
    expect(useRenderQueue.getState().jobs[0].status).toBe('done')
    vi.useRealTimers()
  })
})
