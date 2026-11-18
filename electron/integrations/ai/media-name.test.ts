import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'

// No network here: the service never answers. What is looked at is the name a generation is given when it is started.
const env = vi.hoisted(() => ({ root: '' }))
vi.mock('electron', () => ({
  app: { getPath: (name: string) => path.join(env.root, name), getVersion: () => '1.0.0' },
  net: { fetch: () => new Promise(() => {}) },
  BrowserWindow: class {},
}))
vi.mock('./providers', () => ({ providerKey: () => 'sk-test', providerBaseURL: () => '' }))

env.root = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-media-name-test-'))
const { generateImage, generateVideo } = await import('./media-gen')
const { cancelJob } = await import('../jobs')

afterAll(() => fs.rmSync(env.root, { recursive: true, force: true }))

/** What a generation asked for with `prompt` is called. */
function named(prompt: string) {
  const job = generateImage({ provider: 'openai', model: 'gpt-image-1', prompt, aspect: '16:9' })
  cancelJob(job.id)
  return job.title.replace(/^Image · /, '')
}

describe('the name of what is generated', () => {
  it('is the first few words of what was asked for', () => {
    expect(named('A red kite over a grey sea at dawn, 35mm film')).toBe('A red kite over a')
    expect(named('sunset — golden hour!')).toBe('Sunset golden hour')
    expect(named('!!!')).toBe('Generated')
  })

  it('is a few words in a script written without spaces too', () => {
    // The first five words were what stands between spaces: a Chinese prompt has none, and the picture — and its
    // job in the list — was called by all of it.
    const prompt = '一只橘猫坐在窗台上看着外面下雨的城市街道电影感暖色调浅景深'
    const name = named(prompt)
    expect(prompt.startsWith(name)).toBe(true)
    expect([...name].length).toBeGreaterThanOrEqual(4)
    expect([...name].length).toBeLessThanOrEqual(12)
    // Its marks are no part of the name, and no spaces are put in their place inside a word.
    expect(named('一只橘猫，坐在窗台上。')).toMatch(/^一只橘猫 ?坐在/)
    const video = generateVideo({ provider: 'openai', model: 'sora-2', prompt: '今日はいい天気ですね、散歩に行きましょう', aspect: '16:9', seconds: 4 })
    cancelJob(video.id)
    expect([...video.title.replace(/^Video · /, '')].length).toBeLessThanOrEqual(12)
  })
})
