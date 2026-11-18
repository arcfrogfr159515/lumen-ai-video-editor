import { beforeEach, describe, expect, it } from 'vitest'
import { sourceFrames } from './ops'
import { openSequenceId } from './sequences'
import { getProject } from './store'
import { add, addAsset, freshProject, run } from './test-helpers'

/** How long a timeline at `fps` holding one clip `frames` long is, nested in the open timeline — in the open timeline's frames. */
function nestedLength(fps: number, frames: number) {
  const film = openSequenceId(getProject())
  const id = run('sequence.create', { name: `At ${fps}`, settings: { fps }, open: true }) as string
  add('Overlay', 0, frames, { assetId: 'footage' })
  run('sequence.open', { id: film })
  return { id, length: sourceFrames(getProject(), { sequenceId: id }) }
}

beforeEach(() => {
  freshProject('Film')
  addAsset('footage', 3600)
})

describe('how long a nested timeline is, in the frames of the timeline it is nested in', () => {
  it('is its whole length where the two frame rates give a whole number of frames', () => {
    // Its length was divided by its own rate and then multiplied by the other, and cut down to whole frames:
    // 123 frames at 30 a second is 4.1 s, which times 60 comes to 245.99999999999997 — 245 frames, one short.
    run('project.update', { settings: { fps: 60 } })
    expect(nestedLength(30, 123).length).toBe(246)
    expect(nestedLength(30, 49).length).toBe(98)
    expect(nestedLength(24, 98).length).toBe(245)
    expect(nestedLength(25, 69).length).toBe(165)
  })

  it('is so for every length, at the rates timelines are made at', () => {
    const short: string[] = []
    for (const [from, to] of [[30, 60], [25, 50], [24, 60], [60, 30], [30, 25], [24, 30], [50, 25], [60, 24]] as const) {
      freshProject('Film')
      addAsset('footage', 3600)
      run('project.update', { settings: { fps: to } })
      for (const frames of [1, 7, 49, 69, 98, 123, 147, 196, 245, 999, 1001, 2500]) {
        const got = nestedLength(from, frames).length
        const whole = Math.max(1, Number((BigInt(frames) * BigInt(to)) / BigInt(from)))
        if (got !== whole) short.push(`${frames} frames at ${from} in a timeline at ${to}: ${got}, not ${whole}`)
      }
    }
    expect(short).toEqual([])
  })

  it('is the length a clip of it can have', () => {
    run('project.update', { settings: { fps: 60 } })
    const { id } = nestedLength(30, 123)
    const clip = run('clip.add', { trackId: getProject().tracks.find((t) => t.name === 'Overlay')!.id, kind: 'video', start: 0, duration: 5000, sequenceId: id }) as string
    expect(getProject().clips[clip].duration).toBe(246)
  })
})
