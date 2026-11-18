import { beforeEach, describe, expect, it } from 'vitest'
import { nestedIn, openSequenceId } from './sequences'
import { getProject } from './store'
import { add, addAsset, clip, freshProject, refusal, run } from './test-helpers'

// A clip that plays a nested timeline can hold that as one of its takes while it shows another. Meanwhile the
// nested timeline is free to be given a clip that plays the film — and then showing that take again would put the
// film inside itself.

let film: string
let nested: string
let holder: string
let nestedTake: string
let mediaTake: string

beforeEach(() => {
  freshProject('Takes')
  addAsset('a', 60)
  addAsset('b', 60)
  film = openSequenceId(getProject())
  const a = add('Overlay', 0, 60, { assetId: 'a', name: 'a' })
  const made = run('clip.nest', { ids: [a] }) as { clipId: string; sequenceId: string }
  holder = made.clipId
  nested = made.sequenceId
  // Another take, which is shown at once: the nested timeline is put away as the first.
  mediaTake = (run('take.add', { clipId: holder, assetId: 'b' }) as { takeId: string }).takeId
  nestedTake = clip(holder).takes!.find((t) => t.sequenceId === nested)!.id
  expect(clip(holder).assetId).toBe('b')
})

/** Gives the nested timeline a clip that plays the film — allowed, while nothing in the film plays the nested timeline. */
function filmInsideNested() {
  run('sequence.open', { id: nested })
  const track = getProject().tracks.find((t) => t.kind === 'video')!.id
  run('clip.add', { trackId: track, kind: 'video', start: 100, duration: 30, sequenceId: film })
  run('sequence.open', { id: film })
}

const loops = () => nestedIn(getProject(), film).has(film)

describe('a take that plays a nested timeline', () => {
  it('is shown again like any other while that timeline doesn’t contain this one', () => {
    run('take.switch', { clipId: holder, takeId: nestedTake })
    expect(clip(holder).sequenceId).toBe(nested)
    expect(loops()).toBe(false)
  })

  it('isn’t shown once that timeline has come to contain this one', () => {
    filmInsideNested()
    // It was: the film then played the nested timeline, which plays the film — what adding or pasting a clip refuses.
    expect(refusal('take.switch', { clipId: holder, takeId: nestedTake })).toMatch(/loop/)
    expect(clip(holder).assetId).toBe('b')
    expect(clip(holder).sequenceId).toBeUndefined()
    expect(loops()).toBe(false)
  })

  it('isn’t, by stepping to the next take either', () => {
    filmInsideNested()
    expect(refusal('take.switch', { clipId: holder, step: 1 })).toMatch(/loop/)
    expect(loops()).toBe(false)
  })

  it('isn’t brought back by removing the take that is showing', () => {
    filmInsideNested()
    // Removing the take that shows goes to the one before it — the nested timeline.
    expect(refusal('take.remove', { clipId: holder, takeId: mediaTake })).toMatch(/loop/)
    expect(clip(holder).assetId).toBe('b')
    expect(loops()).toBe(false)
  })
})
