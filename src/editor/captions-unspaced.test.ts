import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Asset, Clip, Project } from './types'

// No audio here: what is said comes from the transcripts the tests give their media.
vi.mock('@/engine/audio-engine', () => ({
  isAudible: (project: Project, clip: Clip) => (clip.kind === 'audio' || clip.kind === 'video') && Boolean(clip.assetId) && !project.tracks.find((t) => t.id === clip.trackId)?.muted,
  loadAudio: async (asset: Asset) => ({ assetId: asset.id }),
  activeRegions: () => [],
  isLongAudio: () => false,
  activeRegionsStreamed: async () => [],
}))

const { addCaptions } = await import('./smart')
const { add, addAsset, freshProject, onTrack, transcript } = await import('./test-helpers')
const { getProject } = await import('./store')
const { clipsOnTrack } = await import('./ops')

const captions = () => clipsOnTrack(getProject(), getProject().tracks.find((t) => t.role === 'captions')!.id).map((c) => c.text!.content)
/** Six seconds of someone saying `text`, as one phrase of the transcript — as Whisper on this computer gives a sentence. */
function says(text: string) {
  addAsset('talk', 6, 'audio', { transcript: transcript([0, 6, text]) })
  add('Voice', 0, 180, { assetId: 'talk' })
}

beforeEach(() => freshProject('Captions'))

describe('captions of speech in a script written without spaces', () => {
  const CHINESE = '我们今天开车去山里看日出，天气非常好。'
  const JAPANESE = '今日はいい天気ですね。散歩に行きましょう。'

  it('are a few words at a time, like any others', () => {
    // A caption holds so many words, and words were what stands between spaces: a Chinese sentence has none, so
    // all of it was one word and one caption — however long the sentence, whatever the style.
    says(CHINESE)
    addCaptions({ style: 'clean' })
    const lines = captions()
    expect(lines.length).toBeGreaterThanOrEqual(2)
    for (const line of lines) expect([...line].length, line).toBeLessThanOrEqual(14)
    // Nothing is lost and nothing is added: no spaces between its words.
    expect(lines.join('')).toBe(CHINESE)
    // Each caption for its share of the phrase's time, one after another.
    const clips = onTrack(getProject().tracks.find((t) => t.role === 'captions')!.name)
    expect(clips[0].start).toBe(0)
    expect(clips.at(-1)!.start + clips.at(-1)!.duration).toBe(180)
  })

  it('are one word at a time in the style that shows one word at a time', () => {
    says(CHINESE)
    addCaptions({ style: 'word' })
    const lines = captions()
    // It was the whole sentence at once, in the biggest letters there are.
    expect(lines.length).toBeGreaterThanOrEqual(8)
    for (const line of lines) expect([...line].length, line).toBeLessThanOrEqual(4)
    expect(lines.join('')).toBe(CHINESE)
    // A mark stays with the word it follows: none begins a caption.
    for (const line of lines) expect(line).not.toMatch(/^[，。！？、]/)
  })

  it('are so in Japanese too', () => {
    says(JAPANESE)
    addCaptions({ style: 'bold' })
    const lines = captions()
    expect(lines.length).toBeGreaterThanOrEqual(3)
    expect(lines.join('')).toBe(JAPANESE)
  })

  it('keep the spaces the transcript has, around words of another script', () => {
    says('我用 iPhone 拍了两段 take，然后剪在一起。')
    addCaptions({ maxWords: 4 })
    expect(captions().join('|').replace(/\|/g, '').replace(/\s/g, '')).toBe('我用iPhone拍了两段take，然后剪在一起。')
    for (const line of captions()) expect(line).toBe(line.trim())
    expect(captions().some((line) => /iPhone 拍|用 iPhone/.test(line))).toBe(true)
  })

  it('keep an opening quote with the word it opens', () => {
    says('他说：“走吧。”然后就走了。')
    addCaptions({ style: 'word' })
    for (const line of captions()) expect(line, line).not.toMatch(/[“「（]$/)
    expect(captions().join('')).toBe('他说：“走吧。”然后就走了。')
  })
})

describe('the words that carry a line, one word at a time', () => {
  const coloured = () => {
    const track = getProject().tracks.find((t) => t.role === 'captions')!
    return clipsOnTrack(getProject(), track.id)
      .filter((c) => c.text!.color === '#ff0055')
      .map((c) => c.text!.content)
  }

  it('are the last of a question or an exclamation, whichever marks the script ends them with', () => {
    // The end of a phrase was known by ! and ? alone: one that ends in ？ or ！ had no word in the accent colour.
    says('你来吗？太好了！我们走。')
    addCaptions({ style: 'word', accent: '#ff0055' })
    expect(captions().join('')).toBe('你来吗？太好了！我们走。')
    expect(coloured()).toEqual(captions().filter((line) => /[？！]$/.test(line)))
    expect(coloured().length).toBe(2)
  })

  it('are as before in a script that ends them with ! and ?', () => {
    says('We built it in 30 days! Did you see? It works.')
    addCaptions({ style: 'word', accent: '#ff0055' })
    expect(coloured()).toEqual(['30', 'days!', 'see?'])
  })
})

describe('captions of speech in a script written with spaces', () => {
  it('are as before', () => {
    says('Today we  build a video editor from scratch together')
    addCaptions({ maxWords: 5 })
    expect(captions()).toEqual(['Today we build a video', 'editor from scratch together'])
    addCaptions({ style: 'word' })
    expect(captions()).toEqual(['Today', 'we', 'build', 'a', 'video', 'editor', 'from', 'scratch', 'together'])
  })
})
