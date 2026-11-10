import { beforeEach, describe, expect, it } from 'vitest'
import { getProject } from './store'
import { add, addAsset, clip, freshProject, run, spans, trackId, transcript } from './test-helpers'
import { cutRanges, fillerWords, findPhrase, plain, repeatedWords, scriptText, scriptWords, timelineScript, tokenize, wordAt } from './text-edit'

const script = () => timelineScript(getProject())
const words = () => scriptWords(script())
const said = () => words().map((w) => w.text).join(' ')

beforeEach(() => {
  freshProject('Script')
  // Two phrases of four words, one second each, with a pause between: 1–2 s and 3–4 s.
  addAsset('talk', 20, 'video', { transcript: transcript([1, 2, 'So um the plan'], [3, 4, 'the plan is simple.']) })
  addAsset('song', 60, 'audio')
})

describe('words', () => {
  it('split on spaces, or into characters where the script has none', () => {
    expect(tokenize('Hello, world — it’s 9 o’clock!')).toEqual(['Hello,', 'world—', 'it’s', '9', 'o’clock!'])
    expect(tokenize('今天，我们去 Paris。')).toEqual(['今', '天，', '我', '们', '去', 'Paris。'])
    expect(tokenize('  ')).toEqual([])
    expect(plain('“Plan,”')).toBe('plan')
  })

  it('are read off the timeline, each with the frames it is said in', () => {
    const id = add('Overlay', 100, 300, { assetId: 'talk' })
    const lines = script()
    expect(lines.map((l) => [l.start, l.end, l.words.length])).toEqual([
      [130, 160, 4],
      [190, 220, 4],
    ])
    const w = words()
    expect(w.map((x) => x.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    expect(w.every((x) => x.clipId === id)).toBe(true)
    // Words follow one another without gaps inside a phrase, longer words taking longer.
    expect(w[0].end).toBe(w[1].start)
    expect(w[3].end - w[3].start).toBeGreaterThan(w[0].end - w[0].start)
    expect(wordAt(w, 131)?.text).toBe('So')
    expect(wordAt(w, 175)).toBeUndefined()
    expect(scriptText(lines)).toBe('So um the plan\nthe plan is simple.')
  })

  it('follow trims, speed, and what is actually heard', () => {
    const id = add('Main', 0, 300, { assetId: 'talk', inPoint: 45 })
    // The clip starts half way through the first phrase: only its last words are on the timeline.
    expect(said()).toBe('the plan the plan is simple.')
    expect(script()[0].partial).toBe(true)
    run('clip.update', { ids: [id], patch: { speed: 2 } })
    expect(script()[1].start).toBe(Math.round((90 - 45) / 2))
    run('clip.update', { ids: [id], patch: { speed: 1, reverse: true } })
    expect(words()).toEqual([])
    run('clip.update', { ids: [id], patch: { reverse: false, audio: { volume: -60 } } })
    expect(words()).toEqual([])
    run('clip.update', { ids: [id], patch: { audio: { volume: 0 } } })
    run('track.update', { id: trackId('Main'), patch: { muted: true } })
    expect(words()).toEqual([])
  })

  it('come from the sound clip once a video’s sound is detached', () => {
    const id = add('Main', 0, 300, { assetId: 'talk' })
    const [sound] = run('clip.detachAudio', { ids: [id] }) as string[]
    expect(words().every((w) => w.clipId === sound)).toBe(true)
    expect(words()).toHaveLength(8)
  })

  it('carry who is speaking', () => {
    const id = add('Main', 0, 300, { assetId: 'talk' })
    run('clip.update', { ids: [id], patch: { speaker: 'Anna' } })
    expect(scriptText(script())).toBe('Anna: So um the plan\nthe plan is simple.')
  })
})

describe('finding words', () => {
  beforeEach(() => {
    add('Main', 0, 300, { assetId: 'talk' })
  })

  it('hesitations', () => {
    expect(fillerWords(words()).map((i) => words()[i].text)).toEqual(['um'])
  })

  it('stumbles: a run said twice, the first saying marked', () => {
    // “the plan the plan”: indexes 2,3 then 4,5.
    expect(repeatedWords(words())).toEqual([2, 3])
    freshProject('Script')
    addAsset('t', 10, 'audio', { transcript: transcript([0, 3, 'I I think it is very very good no no really'], [5, 6, 'good']) })
    add('Voice', 0, 300, { assetId: 't' })
    // “I I” is a stumble; “very very” and “no no” are said on purpose; “good … good” is two seconds apart.
    expect(repeatedWords(words())).toEqual([0])
  })

  it('stumbles across a cut made earlier', () => {
    // Taking the “um” out leaves “the plan” at the end of one clip and “the plan” at the start of the next.
    const [[a, b]] = cutRanges(getProject(), script(), [1])
    run('timeline.removeRange', { start: a, end: b })
    expect(new Set(words().map((w) => w.clipId)).size).toBe(2)
    expect(said()).toBe('So the plan the plan is simple.')
    // The speaker stopped for a second and started the phrase again: within a second (30 frames here) that is a stumble…
    expect(repeatedWords(words())).toEqual([1, 2])
    // …and with less patience it isn't.
    expect(repeatedWords(words(), 10)).toEqual([])
  })

  it('every place a phrase is said, whatever the case or punctuation', () => {
    expect(findPhrase(words(), 'THE PLAN')).toEqual([
      [2, 3],
      [4, 5],
    ])
    expect(findPhrase(words(), 'simple')).toEqual([[7]])
    expect(findPhrase(words(), 'plan is')).toEqual([[5, 6]])
    expect(findPhrase(words(), 'nothing like it')).toEqual([])
    expect(findPhrase(words(), ' ,, ')).toEqual([])
  })
})

describe('cutting by the words', () => {
  it('takes out the frames a word is said in, and the film closes up', () => {
    const id = add('Main', 0, 300, { assetId: 'talk' })
    add('Titles', 200, 60, { kind: 'text' })
    const um = words()[1]
    const [[a, b]] = cutRanges(getProject(), script(), [1])
    // The word, up to where the next one starts.
    expect([a, b]).toEqual([um.start, words()[2].start])
    run('timeline.removeRange', { start: a, end: b })
    expect(said()).toBe('So the plan the plan is simple.')
    expect(spans('Main').at(-1)![1]).toBe(300 - (b - a))
    // Everything after moved with it.
    expect(spans('Titles')).toEqual([[200 - (b - a), 260 - (b - a)]])
    expect(clip(id).duration).toBe(a)
  })

  it('takes the pause after a word with it when the next word follows closely, and not when it doesn’t', () => {
    add('Main', 0, 300, { assetId: 'talk' })
    const w = words()
    // “plan” ends the first phrase; the next word is a second away: only the word goes.
    expect(cutRanges(getProject(), script(), [3])).toEqual([[w[3].start, w[3].end]])
    // Two words in a row are one stretch.
    expect(cutRanges(getProject(), script(), [1, 2])).toEqual([[w[1].start, w[3].start]])
    // Words apart are stretches apart, earliest first.
    expect(cutRanges(getProject(), script(), [6, 0])).toEqual([
      [w[0].start, w[1].start],
      [w[6].start, w[7].start],
    ])
    expect(cutRanges(getProject(), script(), [])).toEqual([])
  })

  it('moves a cut to the quietest moment nearby', () => {
    // Loud everywhere but for a dip 2 frames before the word “the” starts.
    const w0 = (() => {
      add('Main', 0, 300, { assetId: 'talk' })
      return words()
    })()
    const at = w0[2].start
    const peaks = Array.from({ length: 20 * 50 }, () => 0.6)
    const dip = Math.round(((at - 2) / 30) * 50)
    peaks[dip] = 0.01
    run('asset.update', { id: 'talk', patch: { peaks } })
    const [[a]] = cutRanges(getProject(), script(), [2])
    expect(a).toBe(at - 2)
    // With no waveform, the cut stays where the words put it.
    run('asset.update', { id: 'talk', patch: { peaks: [] } })
    expect(cutRanges(getProject(), script(), [2])[0][0]).toBe(at)
  })

  it('removes a whole clip’s worth of words back to the clip’s own edges', () => {
    const id = add('Main', 0, 75, { assetId: 'talk' })
    add('Main', 75, 100, { assetId: 'talk', inPoint: 75 })
    const mine = words().filter((w) => w.clipId === id)
    const [[a, b]] = cutRanges(
      getProject(),
      script(),
      mine.map((w) => w.index),
    )
    expect(a).toBe(mine[0].start)
    expect(b).toBe(mine[mine.length - 1].end)
  })
})
