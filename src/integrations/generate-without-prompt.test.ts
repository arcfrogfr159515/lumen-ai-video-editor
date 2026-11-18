import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Job } from '@shared/integrations'

// No services here: asking one for something is written down, and the job it starts is done at once.
const asked = vi.hoisted(() => ({ calls: [] as { of: string; request: Record<string, unknown> }[], approvals: [] as Record<string, unknown>[] }))

vi.mock('./store', async (original) => {
  const real = await original<typeof import('./store')>()
  let n = 0
  const start = (of: string) => async (request: Record<string, unknown>) => {
    asked.calls.push({ of, request })
    const job = { id: `job_${++n}`, integration: 'elevenlabs', title: of, status: 'done', progress: 1, startedAt: 0 } as Job
    real.useIntegrations.setState((s) => ({ jobs: { ...s.jobs, [job.id]: job } }))
    return job
  }
  return {
    ...real,
    api: { blender: { runLive: async (code: string) => (asked.calls.push({ of: 'blender live', request: { code } }), { ok: true, result: {} }) } },
    elevenSpeak: start('speech'),
    elevenSfx: start('sound effect'),
    elevenMusic: start('music'),
    generateImage: start('image'),
    generateVideo: start('video'),
    renderBlender: start('blender'),
    renderMotion: start('motion graphic'),
    loadGenModels: async () => {},
  }
})
vi.mock('./approvals', async (original) => ({
  ...(await original<typeof import('./approvals')>()),
  // The user says yes to whatever they are shown.
  requestApproval: async (request: Record<string, unknown>) => (asked.approvals.push(request), true),
}))

const { runAgentTool } = await import('./agent-tools')
const { useGenModels, useIntegrations } = await import('./store')
const { useAi } = await import('./ai')
const { freshProject } = await import('@/editor/test-helpers')

/** Each tool that makes something from words, the arguments it can't do without, and a call that has them. */
const TOOLS: [tool: string, needs: string[], good: Record<string, unknown>][] = [
  ['generate_image', ['prompt'], { prompt: 'a red fox in the snow' }],
  ['generate_video', ['prompt'], { prompt: 'a red fox running through snow' }],
  ['generate_voiceover', ['text'], { text: 'Welcome back to the channel.' }],
  ['generate_sound_effect', ['prompt'], { prompt: 'a door closing' }],
  ['generate_music', ['prompt'], { prompt: 'calm piano, slow' }],
  ['render_3d_title', ['text'], { text: 'LUMEN' }],
  ['render_hyperframes_html', ['html', 'name'], { html: '<!doctype html><html></html>', name: 'Title card' }],
  ['render_blender_script', ['script', 'description'], { script: 'import bpy', description: 'A spinning cube' }],
  ['blender_live', ['code', 'description'], { code: 'print(1)', description: 'Says one' }],
]

const call = async (tool: string, args: Record<string, unknown>) => {
  const res = await runAgentTool(tool, { place: false, wait_seconds: 0, ...args })
  const said = res.content.find((c) => c.type === 'text')
  return { refused: res.isError === true, said: said && 'text' in said ? said.text : '' }
}
/** Everything a service, or the user, was handed: no part of it may be the word a missing argument turns into. */
const handed = () => JSON.stringify([asked.calls, asked.approvals])

beforeEach(() => {
  asked.calls = []
  asked.approvals = []
  freshProject('Film')
  useIntegrations.setState({ voices: [{ id: 'voice_1', name: 'Narrator' }] })
  useAi.setState({ providers: { openai: { id: 'openai', configured: true } } as never })
  useGenModels.setState({ models: { openai: { image: ['gpt-image-1'], video: ['sora-2'] } } as never })
})

describe('a tool that makes something from words, called without them', () => {
  for (const [tool, needs, good] of TOOLS) {
    for (const need of needs) {
      const without = Object.fromEntries(Object.entries(good).filter(([key]) => key !== need))

      // What a model sends isn't checked against the schema. `String(a.prompt)` of a call without one is the word
      // “undefined”: the service was asked for that — and paid for it — and what it made went into the project.
      it(`${tool} asks no service for “undefined” when ${need} is missing`, async () => {
        const res = await call(tool, without)
        expect(handed()).not.toContain('undefined')
        expect(asked.calls).toEqual([])
        expect(asked.approvals).toEqual([])
        expect(res.refused).toBe(true)
        expect(res.said).toContain(need)
      })

      it(`${tool} says so when ${need} came under another name, or empty`, async () => {
        for (const args of [{ ...without, [`${need}_text`]: good[need] }, { ...without, [need]: '   ' }, { ...without, [need]: null }, { ...without, [need]: 42 }]) {
          const res = await call(tool, args)
          expect(asked.calls).toEqual([])
          expect(asked.approvals).toEqual([])
          expect(res.refused).toBe(true)
          expect(res.said).toContain(need)
        }
      })
    }

    it(`${tool} is carried out with what it needs`, async () => {
      const res = await call(tool, good)
      expect(res.said).not.toMatch(/^Give /)
      expect(asked.calls).toHaveLength(1)
      for (const need of needs) expect(handed()).toContain(JSON.stringify(good[need]).slice(1, -1))
    })
  }
})
