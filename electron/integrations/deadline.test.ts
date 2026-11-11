import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// No network here: every service is a script each test writes. One that "never answers" waits for the request to be given up.
type Answer = (url: URL, init: RequestInit) => Response | Promise<Response>
const env = vi.hoisted(() => ({ root: '', answer: null as unknown as Answer, calls: [] as string[], handler: null as ((req: Request) => Promise<Response>) | null }))
const scripted = async (url: string | URL, init: RequestInit = {}) => {
  env.calls.push(String(url))
  return await env.answer(new URL(String(url)), init)
}

vi.mock('electron', () => ({
  app: { getPath: (name: string) => path.join(env.root, name), getVersion: () => '1.0.0' },
  net: { fetch: scripted },
  dialog: {},
  shell: {},
  safeStorage: {},
  BrowserWindow: class {},
  protocol: { handle: (_scheme: string, fn: (req: Request) => Promise<Response>) => void (env.handler = fn) },
}))
vi.mock('./ai/providers', () => ({ providerKey: () => 'sk-test', providerBaseURL: () => '' }))
vi.mock('./secrets', () => ({ getSecret: () => 'el-test', setSecret: () => {}, secretHint: () => '…test' }))

env.root = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-deadline-test-'))
const { steadyFetch, within } = await import('./deadline')
const { MODEL_LIMITS, registerMediaProtocol } = await import('../files')
const { TRANSCRIBE_LIMITS, transcribeWithOpenAI } = await import('./ai/transcribe')
const { generateImage, generateVideo, MEDIA_LIMITS, mediaModels } = await import('./ai/media-gen')
const { ELEVENLABS_LIMITS, listVoices, speak } = await import('./elevenlabs')
const { getJob } = await import('./jobs')
registerMediaProtocol()

/** A server that takes the request and never says anything, until the request is given up. */
const silent = (_url: URL, init: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    if (init.signal?.aborted) return reject(init.signal.reason)
    init.signal?.addEventListener('abort', () => reject(init.signal!.reason))
  })
/** A body of `pieces` pieces `gap` ms apart; then it ends, or goes quiet for good. */
function body(pieces: number, gap: number, then: 'end' | 'quiet', signal?: AbortSignal | null) {
  let sent = 0
  return new ReadableStream<Uint8Array>({
    start(controller) {
      signal?.addEventListener('abort', () => controller.error(signal.reason))
    },
    async pull(controller) {
      if (sent++ < pieces) {
        await new Promise((r) => setTimeout(r, gap))
        return controller.enqueue(new Uint8Array(1000))
      }
      if (then === 'end') return controller.close()
      return new Promise<void>(() => {})
    },
  })
}
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
const settled = async (id: string) => {
  for (let i = 0; i < 200 && getJob(id)?.status === 'running'; i++) await new Promise((r) => setTimeout(r, 10))
  return getJob(id)!
}
const kept = { model: { ...MODEL_LIMITS }, transcribe: { ...TRANSCRIBE_LIMITS }, media: { ...MEDIA_LIMITS }, eleven: { ...ELEVENLABS_LIMITS } }
const realFetch = globalThis.fetch

afterAll(() => fs.rmSync(env.root, { recursive: true, force: true }))
beforeEach(() => {
  env.calls.length = 0
  env.answer = () => new Response('not scripted', { status: 500 })
  Object.assign(MODEL_LIMITS, kept.model)
  Object.assign(TRANSCRIBE_LIMITS, kept.transcribe)
  Object.assign(MEDIA_LIMITS, kept.media)
  Object.assign(ELEVENLABS_LIMITS, kept.eleven)
  globalThis.fetch = scripted as typeof fetch
})
afterEach(() => {
  globalThis.fetch = realFetch
})

describe('a request with a time to finish', () => {
  it('gives what it got when it finishes in time', async () => {
    expect(await within(1000, 'The service', null, async () => 'done')).toBe('done')
  })

  it('fails by name when the time runs out', async () => {
    await expect(within(30, 'The service', null, (signal) => silent(new URL('https://x.test'), { signal }))).rejects.toThrow('The service took too long to answer (more than 0 seconds).')
    // Cancelled before it began: that is the user's doing, not the service's.
    await expect(within(180_000, 'The service', AbortSignal.abort(new Error('Cancelled by the user')), (signal) => silent(new URL('https://x.test'), { signal }))).rejects.toThrow('Cancelled by the user')
  })

  it('leaves a cancel and a failure as they are', async () => {
    const cancel = new AbortController()
    const waiting = within(5000, 'The service', cancel.signal, (signal) => silent(new URL('https://x.test'), { signal }))
    cancel.abort(new Error('Cancelled by the user'))
    await expect(waiting).rejects.toThrow('Cancelled by the user')
    await expect(within(5000, 'The service', null, async () => Promise.reject(new Error('401')))).rejects.toThrow('401')
  })
})

describe('a download that keeps coming', () => {
  it('may take longer than any one wait', async () => {
    env.answer = () => new Response(body(8, 20, 'end'))
    const res = await steadyFetch('https://files.example.com/big.bin', {}, { answerMs: 60, stallMs: 60 })
    // 160 ms of download with 60 ms of patience: it is the silence that is timed, not the whole.
    expect((await res.arrayBuffer()).byteLength).toBe(8000)
  })

  it('gives up on a server that never answers', async () => {
    env.answer = silent
    await expect(steadyFetch('https://files.example.com/big.bin', {}, { answerMs: 40, stallMs: 1000 })).rejects.toThrow('files.example.com took too long to answer.')
  })

  it('gives up on a body that goes quiet', async () => {
    env.answer = (_url, init) => new Response(body(2, 5, 'quiet', init.signal))
    const res = await steadyFetch('https://files.example.com/big.bin', {}, { answerMs: 1000, stallMs: 50 })
    await expect(res.arrayBuffer()).rejects.toThrow('files.example.com stopped sending part-way.')
  })

  it('passes on answers that have no body, and the user’s cancel', async () => {
    env.answer = () => new Response(null, { status: 304 })
    expect((await steadyFetch('https://files.example.com/a')).status).toBe(304)
    env.answer = () => new Response(null, { status: 404, statusText: 'Not Found' })
    const missing = await steadyFetch('https://files.example.com/a')
    expect([missing.status, missing.ok]).toEqual([404, false])
    env.answer = silent
    const cancel = new AbortController()
    const waiting = steadyFetch('https://files.example.com/a', { signal: cancel.signal })
    cancel.abort(new Error('Cancelled by the user'))
    await expect(waiting).rejects.toThrow('Cancelled by the user')
  })
})

describe('on-device models', () => {
  const model = 'lumen-media://models/onnx-community/whisper-base/resolve/main/onnx/encoder.onnx'
  const cached = path.join(env.root, 'userData', 'models', 'onnx-community', 'whisper-base', 'main', 'onnx')
  const files = () => (fs.existsSync(cached) ? fs.readdirSync(cached) : [])

  it('download through to the editor and are kept for next time', async () => {
    env.answer = () => new Response(body(4, 5, 'end'), { headers: { 'content-length': '4000' } })
    const res = await env.handler!(new Request(model))
    expect((await res.arrayBuffer()).byteLength).toBe(4000)
    for (let i = 0; i < 100 && !files().includes('encoder.onnx'); i++) await new Promise((r) => setTimeout(r, 10))
    expect(files()).toEqual(['encoder.onnx'])
    // The second time it comes from the disk: nothing is asked of the network.
    env.calls.length = 0
    expect((await (await env.handler!(new Request(model))).arrayBuffer()).byteLength).toBe(4000)
    expect(env.calls).toEqual([])
    fs.rmSync(cached, { recursive: true, force: true })
  })

  it('fail instead of hanging when Hugging Face never answers', async () => {
    MODEL_LIMITS.answerMs = 40
    env.answer = silent
    await expect(env.handler!(new Request(model))).rejects.toThrow('huggingface.co took too long to answer.')
    await expect(env.handler!(new Request(model, { headers: { Range: 'bytes=0-0' } }))).rejects.toThrow('huggingface.co took too long to answer.')
  })

  it('fail instead of hanging when the download goes quiet, and keep no half of a model', async () => {
    MODEL_LIMITS.stallMs = 50
    env.answer = (_url, init) => new Response(body(3, 5, 'quiet', init.signal))
    const res = await env.handler!(new Request(model))
    await expect(res.arrayBuffer()).rejects.toThrow()
    await new Promise((r) => setTimeout(r, 60))
    expect(files()).toEqual([])
  })
})

describe('services that never answer', () => {
  it('OpenAI transcription fails by name', async () => {
    TRANSCRIBE_LIMITS.ms = 40
    env.answer = silent
    await expect(transcribeWithOpenAI(new Uint8Array(100))).rejects.toThrow(/^OpenAI took too long to answer/)
    // An answer that comes is read as before.
    env.answer = () => json({ segments: [{ start: 0, end: 1.5, text: ' Hello there. ' }] })
    expect(await transcribeWithOpenAI(new Uint8Array(100))).toEqual([{ start: 0, end: 1.5, text: 'Hello there.' }])
    env.answer = () => json({ error: 'no' }, 401)
    await expect(transcribeWithOpenAI(new Uint8Array(100))).rejects.toThrow('OpenAI rejected the API key.')
  })

  it('the list of models fails by name', async () => {
    MEDIA_LIMITS.listMs = 40
    env.answer = silent
    await expect(mediaModels('openai', true)).rejects.toThrow(/^OpenAI took too long to answer/)
    await expect(mediaModels('gemini', true)).rejects.toThrow(/^Google took too long to answer/)
  })

  it('an image job fails instead of working for ever', async () => {
    MEDIA_LIMITS.imageMs = 40
    env.answer = silent
    for (const provider of ['openai', 'gemini'] as const) {
      const job = await settled(generateImage({ provider, model: provider === 'openai' ? 'gpt-image-1' : 'gemini-image', prompt: 'A red kite', aspect: '16:9' }).id)
      expect(job.status).toBe('error')
      expect(job.error).toMatch(provider === 'openai' ? /^OpenAI took too long to answer/ : /^Google took too long to answer/)
    }
  })

  it('a video job fails when a look at its progress never comes back', async () => {
    MEDIA_LIMITS.pollMs = 40
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    try {
      env.answer = (url, init) => (init.method === 'POST' ? json({ id: 'vid_1' }) : silent(url, init))
      const started = generateVideo({ provider: 'openai', model: 'sora-2', prompt: 'A red kite', aspect: '16:9', seconds: 4 })
      // The wait between two looks is skipped; the look itself is on a real clock.
      await vi.advanceTimersByTimeAsync(4000)
      vi.useRealTimers()
      const job = await settled(started.id)
      expect(job.status).toBe('error')
      expect(job.error).toMatch(/^OpenAI took too long to answer \(more than 0 seconds\)/)
    } finally {
      vi.useRealTimers()
    }
  })

  it('an ElevenLabs job fails by name, and so does the list of voices', async () => {
    ELEVENLABS_LIMITS.ms = 40
    env.answer = silent
    const job = await settled(speak({ text: 'Hello there', voiceId: 'v1' }).id)
    expect(job.status).toBe('error')
    expect(job.error).toBe('ElevenLabs took too long to answer.')
    await expect(listVoices()).rejects.toThrow('ElevenLabs took too long to answer.')
  })
})
