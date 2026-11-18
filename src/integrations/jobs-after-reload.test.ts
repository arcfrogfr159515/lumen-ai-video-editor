import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GeneratedAsset, Job } from '@shared/integrations'
import type { Project } from '@/editor/types'

vi.mock('sonner', () => ({ toast: Object.assign(() => {}, { error: () => {}, success: () => {}, loading: () => 1, dismiss: () => {} }) }))
vi.mock('@/engine/decode', () => ({
  MediaError: class extends Error {},
  kindFromMime: () => 'audio',
  probeMedia: async () => ({ kind: 'audio', duration: 2, hasAudio: true }),
}))
vi.mock('@/project/media-import', async (original) => ({ ...(await original<typeof import('@/project/media-import')>()), analyzeAssets: async () => {} }))

/**
 * The main process, which outlives the editor's window: the jobs of its session, and the window it tells about them.
 * And what a window keeps for the next one (localStorage).
 */
const main = { jobs: [] as Job[], tell: null as null | ((job: Job) => void) }
const kept = new Map<string, string>()
const storage = { getItem: (key: string) => kept.get(key) ?? null, setItem: (key: string, value: string) => void kept.set(key, value), removeItem: (key: string) => void kept.delete(key) }
vi.stubGlobal('localStorage', storage)
vi.stubGlobal('window', {
  localStorage: storage,
  lumen: {
    isElectron: true,
    platform: 'win32',
    versions: { electron: '0', chrome: '0' },
    integrations: {
      onJob: (fn: (job: Job) => void) => ((main.tell = fn), () => {}),
      onMcp: () => () => {},
      jobs: { list: async () => main.jobs },
      mcp: { list: async () => [] },
      blender: { detect: async () => null },
      elevenlabs: { state: async () => ({ configured: false }) },
    },
  },
})

const settle = () => new Promise((r) => setTimeout(r, 5))

/** The editor's window, opened (again): everything it knew is gone, and the main process lists its jobs to it. */
async function openWindow(before?: (load: (p: Project) => void) => void) {
  vi.resetModules()
  const editor = await import('@/editor/store')
  before?.((p) => editor.useEditor.getState().loadProject(p))
  const store = await import('./store')
  store.startIntegrations()
  await settle()
  return {
    project: () => editor.getProject(),
    media: () => Object.values(editor.getProject().assets).map((a) => a.name),
    of: (jobId: string) => store.useIntegrations.getState().imported[jobId],
  }
}

const sound = (name: string): GeneratedAsset => ({
  name,
  kind: 'audio',
  source: { type: 'file', url: `lumen-media://local/elevenlabs/${name}.mp3`, path: `C:/media/${name}.mp3`, mime: 'audio/mpeg', fileName: `${name}.mp3`, size: 10 },
  provenance: { integration: 'elevenlabs', tool: 'sound effect' },
})
const job = (id: string, status: Job['status'], made?: string): Job => ({ id, integration: 'elevenlabs', title: 'Sound effect', status, progress: status === 'done' ? 1 : -1, startedAt: 0, ...(made ? { assets: [sound(made)] } : {}) })

/** A job runs and finishes while a window is open: the main process tells the window, and keeps the job in its list. */
async function finishes(id: string, made: string) {
  main.tell!(job(id, 'running'))
  main.jobs = [...main.jobs.filter((j) => j.id !== id), job(id, 'done', made)]
  main.tell!(job(id, 'done', made))
  await settle()
}

beforeEach(() => {
  main.jobs = []
  main.tell = null
  kept.clear()
})

describe('what a job made, and a window opened after it', () => {
  it('is brought into the project when the job finishes', async () => {
    const first = await openWindow()
    await finishes('job_1', 'door')
    expect(first.media()).toEqual(['door'])
    expect(first.of('job_1')).toHaveLength(1)
  })

  it('is not brought in again by a window opened later', async () => {
    // The editor is reloaded after a crash, or reopened (on a Mac, a new window after the last one was closed):
    // the main process lists the jobs of its session to it, the finished ones with what they made. Each brought
    // its media in again — into the new, empty project the window opens with, which then had changes to save.
    await openWindow()
    await finishes('job_1', 'door')
    const second = await openWindow()
    expect(second.media()).toEqual([])
  })

  it('still counts as the job’s media where the project has it', async () => {
    const first = await openWindow()
    await finishes('job_1', 'door')
    const saved = structuredClone(first.project())
    const [id] = Object.keys(saved.assets)
    const second = await openWindow((load) => load(saved))
    expect(second.media()).toEqual(['door'])
    expect(second.of('job_1')).toEqual([id])
  })

  it('is brought in by the next window when the job finished with none open', async () => {
    main.jobs = [job('job_2', 'done', 'rain')]
    const window = await openWindow()
    expect(window.media()).toEqual(['rain'])
    // And by that one only.
    const next = await openWindow()
    expect(next.media()).toEqual([])
  })

  it('is brought in when a job the window found running finishes', async () => {
    main.jobs = [job('job_3', 'running')]
    const window = await openWindow()
    await finishes('job_3', 'wind')
    expect(window.media()).toEqual(['wind'])
  })
})
