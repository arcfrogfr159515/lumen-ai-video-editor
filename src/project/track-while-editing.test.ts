import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('sonner', () => ({ toast: Object.assign(() => {}, { error: () => {}, success: () => {}, loading: () => 1, dismiss: () => {} }) }))

// No footage is read here. What is followed drifts right by a thousandth of the picture each frame of the file
// (30 a second), and the tracker answers when the test lets it: reading the frames of a long clip takes a while.
const lab = vi.hoisted(() => ({ waiting: [] as (() => void)[], asked: null as null | (() => void) }))
vi.mock('@/engine/tracker', () => ({
  measureShake: async () => ({ start: 0, rate: 30, path: [] }),
  trackBox: async (_asset: unknown, box: { x: number; y: number }, from: number, to: number) => {
    await new Promise<void>((resolve) => {
      lab.waiting.push(resolve)
      lab.asked?.()
    })
    const dir = to >= from ? 1 : -1
    const count = Math.round(Math.abs(to - from) * 30)
    return Array.from({ length: count + 1 }, (_, k) => ({ t: from + (dir * k) / 30, x: box.x + 0.001 * dir * k, y: box.y, score: 1 }))
  },
}))

const { trackMotion } = await import('./analysis-actions')
const { getProject } = await import('@/editor/store')
const { add, addAsset, freshProject, run } = await import('@/editor/test-helpers')

/** Resolves when the tracker has been asked to follow something. */
const asked = () => new Promise<void>((resolve) => (lab.waiting.length ? resolve() : (lab.asked = resolve)))
/** Lets the tracker answer — every pass of it: forwards, then backwards. */
async function answer() {
  for (let i = 0; i < 4; i++) {
    lab.waiting.splice(0).forEach((go) => go())
    await new Promise((r) => setTimeout(r, 0))
  }
}

let opener = ''
let shot = ''
let mask = ''
const follow = () => getProject().clips[shot].masks!.find((m) => m.id === mask)!.follow!

/**
 * The main track: an opener over frames 0–100, then a shot over 100–400 with a mask on it. The mask is to follow
 * what is in the middle of the picture on frame 150 — fifty frames into the shot.
 */
beforeEach(() => {
  lab.waiting = []
  lab.asked = null
  freshProject('Tracking')
  addAsset('intro', 20, 'video', { width: 1920, height: 1080 })
  addAsset('cam', 20, 'video', { width: 1920, height: 1080 })
  opener = add('Main', 0, 100, { assetId: 'intro' })
  shot = add('Main', 100, 300, { assetId: 'cam' })
  mask = run('mask.add', { clipId: shot, mask: {} }) as string
})

const track = (direction: 'forward' | 'both') => trackMotion({ targetId: shot, maskId: mask, box: { x: 0, y: 0, width: 200, height: 200 }, direction, frame: 150 })

describe('a mask made to follow something in its clip', () => {
  it('follows it from the frame the box was put on', async () => {
    const tracking = track('forward')
    await asked()
    await answer()
    await tracking
    expect(follow().start).toBe(50)
    expect(follow().ref).toBe(0)
    expect(follow().points).toHaveLength(500)
    expect(follow().points.slice(0, 6)).toEqual([0.5, 0.5, 0.501, 0.5, 0.502, 0.5])
  })

  it('follows it the same when the clip was moved along the timeline while its footage was read', async () => {
    // What it should be: tracked with nothing else going on.
    const undisturbed = track('both')
    await asked()
    await answer()
    await undisturbed
    const wanted = structuredClone(follow())
    expect(wanted).toMatchObject({ start: 0, ref: 50 })
    run('mask.update', { clipId: shot, maskId: mask, patch: { follow: null } })

    // The opener is deleted while the tracker reads the shot: the main track closes up, and the shot now starts at 0.
    // The path was laid out by the frames the shot had covered before, and counted from where it starts now: it
    // began a hundred frames late, and ran on past the end of the clip.
    const tracking = track('both')
    await asked()
    run('clip.delete', { ids: [opener] })
    expect(getProject().clips[shot].start).toBe(0)
    await answer()
    await tracking
    expect(follow()).toEqual(wanted)
  })

  it('follows it where the clip shows it now, when the clip was slipped meanwhile', async () => {
    const tracking = track('forward')
    await asked()
    // Thirty frames later footage: what the box was put on is shown thirty frames earlier, twenty frames in.
    run('clip.slip', { id: shot, frames: 30 })
    expect(getProject().clips[shot].inPoint).toBe(30)
    await answer()
    await tracking
    expect(follow().start).toBe(20)
    expect(follow().ref).toBe(0)
    expect(follow().points.slice(0, 6)).toEqual([0.5, 0.5, 0.501, 0.5, 0.502, 0.5])
  })
})
