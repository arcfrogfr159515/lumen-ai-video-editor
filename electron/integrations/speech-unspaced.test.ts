import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'

// No network here: each service answers with what the test wrote for it.
const env = vi.hoisted(() => ({ root: '', openai: {} as unknown, eleven: {} as unknown }))
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })

vi.mock('electron', () => ({
  app: { getPath: (name: string) => path.join(env.root, name), getVersion: () => '1.0.0' },
  net: { fetch: async () => json(env.openai) },
  dialog: {},
  shell: {},
  safeStorage: {},
  BrowserWindow: class {},
}))
vi.mock('./ai/providers', () => ({ providerKey: () => 'sk-test', providerBaseURL: () => '' }))
vi.mock('./secrets', () => ({ getSecret: () => 'el-test', setSecret: () => {}, secretHint: () => '…test', keychainSettled: async () => {} }))
vi.stubGlobal('fetch', async () => json(env.eleven))

env.root = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-speech-test-'))
const { phrases, speak } = await import('./elevenlabs')
const { transcribeWithOpenAI } = await import('./ai/transcribe')
const { getJob } = await import('./jobs')

afterAll(() => fs.rmSync(env.root, { recursive: true, force: true }))

/** Words said one after another, a third of a second each. */
const said = (...words: string[]) => words.map((text, i) => ({ text, start: i * 0.3, end: i * 0.3 + 0.3 }))
const texts = (segments: { text: string }[]) => segments.map((s) => s.text)

describe('what was said, as phrases', () => {
  it('is written without spaces where the script has none', () => {
    // Words were joined with a space whatever they were written in: Chinese came out as "我们 开车 去 山里" — or,
    // from a service that times each character, "我 们 开 车" — in the transcript, the captions and the script.
    expect(texts(phrases(said('我们', '开车', '去', '山里')))).toEqual(['我们开车去山里'])
    expect(texts(phrases(said('我', '们', '开', '车', '去', '山', '里')))).toEqual(['我们开车去山里'])
    expect(texts(phrases(said('今日', 'は', 'いい', '天気', 'です')))).toEqual(['今日はいい天気です'])
    // Beside a word of another script too, as it is written in such a sentence.
    expect(texts(phrases(said('我', '用', 'iPhone', '拍', '的')))).toEqual(['我用iPhone拍的'])
    // Words that are written with spaces keep them, wherever they stand.
    expect(texts(phrases(said('拍', 'two', 'takes', '吧')))).toEqual(['拍two takes吧'])
  })

  it('ends where a sentence ends, in those scripts as in the others', () => {
    // Only . ! ? … ended a phrase: a sentence that ends in 。 ran on into the next one.
    expect(texts(phrases(said('我们', '开车', '去', '山里。', '天气', '很好！', '你', '来', '吗？', '来')))).toEqual(['我们开车去山里。', '天气很好！', '你来吗？', '来'])
    expect(texts(phrases(said('「行こう。」', 'と', '言った')))).toEqual(['「行こう。」', 'と言った'])
  })

  it('is as before in a script written with spaces', () => {
    expect(texts(phrases(said('Hello', 'there.', 'General', 'Kenobi!', 'You', 'are', 'a', 'bold', 'one')))).toEqual(['Hello there.', 'General Kenobi!', 'You are a bold one'])
    expect(texts(phrases(said('one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven')))).toEqual(['one two three four five six seven eight nine ten', 'eleven'])
    expect(texts(phrases(said('안녕하세요', '여러분')))).toEqual(['안녕하세요 여러분'])
  })
})

describe('speech transcribed by a service that times each word', () => {
  it('comes back written as the language is', async () => {
    env.openai = { words: said('我', '们', '开', '车', '去', '山', '里').map((w) => ({ word: w.text, start: w.start, end: w.end })) }
    expect(texts(await transcribeWithOpenAI(new Uint8Array(44)))).toEqual(['我们开车去山里'])
  })
})

describe('a voiceover made from text in a script without spaces', () => {
  it('is timed phrase by phrase, not as one word as long as the text', async () => {
    // The text has no spaces, so all of it was one word and one phrase: one caption for the whole voiceover.
    const characters = [...'你好，世界。今天天气很好。我们出发吧']
    env.eleven = {
      audio_base64: Buffer.from('mp3').toString('base64'),
      alignment: { characters, character_start_times_seconds: characters.map((_, i) => i * 0.2), character_end_times_seconds: characters.map((_, i) => i * 0.2 + 0.2) },
    }
    const started = speak({ text: characters.join(''), voiceId: 'v1' })
    for (let i = 0; i < 200 && getJob(started.id)?.status === 'running'; i++) await new Promise((r) => setTimeout(r, 10))
    const job = getJob(started.id)!
    expect(job.error).toBeUndefined()
    const transcript = job.assets![0].transcript!
    expect(texts(transcript)).toEqual(['你好，世界。', '今天天气很好。', '我们出发吧'])
    // Each phrase where it is said.
    expect(transcript.map((s) => [Math.round(s.start * 10) / 10, Math.round(s.end * 10) / 10])).toEqual([
      [0, 1.2],
      [1.2, 2.6],
      [2.6, 3.6],
    ])
  })

  it('is timed word by word as before in a script written with spaces', async () => {
    const characters = [...'Hello there. Off we go']
    env.eleven = {
      audio_base64: Buffer.from('mp3').toString('base64'),
      alignment: { characters, character_start_times_seconds: characters.map((_, i) => i * 0.1), character_end_times_seconds: characters.map((_, i) => i * 0.1 + 0.1) },
    }
    const started = speak({ text: characters.join(''), voiceId: 'v1' })
    for (let i = 0; i < 200 && getJob(started.id)?.status === 'running'; i++) await new Promise((r) => setTimeout(r, 10))
    expect(texts(getJob(started.id)!.assets![0].transcript!)).toEqual(['Hello there.', 'Off we go'])
  })
})
