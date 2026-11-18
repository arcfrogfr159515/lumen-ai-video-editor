import { beforeEach, describe, expect, it } from 'vitest'
import { batchNames } from './batch'
import { getProject } from './store'
import { add, addAsset, clip, freshProject, run, trackId } from './test-helpers'

// A pattern's tokens stand for a clip's own words — its name, its media's, its track's. Those words are put in as
// they are: a dollar sign in them is a dollar sign, and a brace in them is not a token.

beforeEach(() => {
  freshProject('Batch names')
  addAsset('song', 60, 'audio')
  addAsset('broll', 60)
})

const rename = (ids: string[], pattern: string) => run('clip.batch', { ids, rename: pattern })

describe('renaming clips by pattern', () => {
  it('keeps every dollar sign of the name a clip has', () => {
    const cash = add('Main', 0, 60, { assetId: 'broll', name: '$$$ money shot' })
    rename([cash], '{name} — take {n}')
    // It read “$$ money shot — take 1”: two dollars in a row were taken for one.
    expect(clip(cash).name).toBe('$$$ money shot — take 1')
  })

  it('keeps a dollar sign that stands before another sign', () => {
    const rnb = add('Main', 0, 60, { assetId: 'broll', name: 'R$&B set' })
    const quote = add('Main', 60, 60, { assetId: 'broll', name: "The 5$'s" })
    const tick = add('Main', 120, 60, { assetId: 'broll', name: 'Win $` big' })
    rename([rnb, quote, tick], '{n}. {name} (cut)')
    // “$&” put the token itself back (“1. R{name}B set (cut)”), “$'” what came after it, “$`” what came before.
    expect([rnb, quote, tick].map((id) => clip(id).name)).toEqual(['1. R$&B set (cut)', "2. The 5$'s (cut)", '3. Win $` big (cut)'])
  })

  it('keeps them in the name of the media and of the track', () => {
    addAsset('cash', 60, 'audio', { name: 'Ca$$h money.mp3' })
    run('track.update', { id: trackId('Music'), patch: { name: 'Music $$' } })
    const a = add('Music $$', 0, 60, { assetId: 'cash', name: 'Bed' })
    expect(batchNames(getProject(), [a], '{source}')?.get(a)).toBe('Ca$$h money.mp3')
    expect(batchNames(getProject(), [a], '{track}: {name}')?.get(a)).toBe('Music $$: Bed')
  })

  it('takes a brace in a clip’s own name for what it is', () => {
    // A name that holds a token — the pattern typed into the name field by mistake, a file called “{tc}.mov” — is
    // the name. It was read again as part of the pattern, by the tokens that came after “{name}”.
    const odd = add('Main', 0, 60, { assetId: 'broll', name: 'Draft {source} {tc}' })
    expect(batchNames(getProject(), [odd], 'Keep: {name}')?.get(odd)).toBe('Keep: Draft {source} {tc}')
  })

  it('still fills every token, and leaves what isn’t one', () => {
    const a = add('Main', 0, 60, { assetId: 'broll', name: 'First' })
    const b = add('Music', 60, 60, { assetId: 'song', name: 'Second' })
    const names = batchNames(getProject(), [b, a], '{nn}/{n} {name} · {source} · {track} · {tc} · {nope} · {name}')
    expect(names?.get(a)).toBe('01/1 First · broll · Main · 00:00:00:00 · {nope} · First')
    expect(names?.get(b)).toBe('02/2 Second · song · Music · 00:00:02:00 · {nope} · Second')
  })
})
