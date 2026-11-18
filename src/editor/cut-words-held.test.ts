import { describe, expect, it } from 'vitest'
import { cutSpokenWords } from './smart'
import { getProject, useEditor } from './store'
import { add, addAsset, freshProject, run, spans, trackId, transcript } from './test-helpers'
import { scriptWords, timelineScript } from './text-edit'

/** Ten seconds of talk on the Voice track, pictures over it, and — for some — a second speaker further on. */
function film() {
  freshProject('Script')
  addAsset('talk', 10, 'audio', { transcript: transcript([0, 2, 'one two three'], [3, 5, 'four five six']) })
  addAsset('answer', 10, 'audio', { transcript: transcript([0, 2, 'seven eight nine']) })
  addAsset('pictures', 60)
  add('Voice', 0, 300, { assetId: 'talk' })
  add('Overlay', 0, 600, { assetId: 'pictures' })
}

const said = () => scriptWords(timelineScript(getProject())).map((w) => w.text)
const indexOf = (word: string) => scriptWords(timelineScript(getProject())).find((w) => w.text === word)!.index

describe('words cut out of speech that can’t be cut', () => {
  for (const hold of [{ locked: true }, { syncLock: false }, { rippleLock: true }]) {
    it(`leave the timeline as it is, and say why (${JSON.stringify(hold)})`, () => {
      film()
      run('track.update', { id: trackId('Voice'), patch: hold })
      const before = getProject()
      const steps = useEditor.getState().past.length
      // The word stays in the speech — a stretch comes out of the tracks that follow ripples, and its track isn't
      // one. Its frames came out of the pictures all the same, and nothing was said.
      const res = cutSpokenWords([indexOf('two')], { source: 'ai' })
      expect(res).toMatchObject({ frames: 0, cuts: 0 })
      expect(res.error).toMatch(/locked or doesn’t follow ripple edits/)
      expect(said()).toEqual(['one', 'two', 'three', 'four', 'five', 'six'])
      expect(spans('Overlay')).toEqual([[0, 600]])
      expect(getProject()).toBe(before)
      expect(useEditor.getState().past).toHaveLength(steps)
    })
  }

  it('are left, while those of speech that can be cut go', () => {
    film()
    run('track.add', { kind: 'audio', name: 'Interview B' })
    add('Interview B', 300, 300, { assetId: 'answer' })
    run('track.update', { id: trackId('Interview B'), patch: { rippleLock: true } })
    const res = cutSpokenWords([indexOf('two'), indexOf('eight')], { source: 'ai' })
    expect(res.cuts).toBe(1)
    expect(res.error).toMatch(/locked or doesn’t follow ripple edits/)
    // “two” is gone and “eight” is still said; the pictures are shorter by the one cut.
    expect(said()).toEqual(['one', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'])
    expect(spans('Overlay').at(-1)![1]).toBe(600 - res.frames)
    expect(spans('Interview B')).toEqual([[300, 600]])
  })
})
