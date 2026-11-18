import { beforeEach, describe, expect, it, vi } from 'vitest'

// No screen here: Chromium's capture is a stand-in whose pictures the test can see being stopped. Listing what can
// be recorded, and being handed a picture, each take until the test says so (the real ones take up to a second).
interface FakeTrack {
  readyState: 'live' | 'ended'
}
const lab = vi.hoisted(() => ({
  tracks: [] as FakeTrack[],
  hold: { list: false, picture: false },
  waiting: { list: null as null | (() => void), picture: null as null | (() => void) },
  asked: { list: 0, picture: 0 },
}))

vi.mock('sonner', () => ({ toast: Object.assign(() => {}, { error: () => {}, success: () => {}, loading: () => 1, dismiss: () => {}, warning: () => {} }) }))
vi.mock('@/engine/decode', () => ({ probeMedia: async () => null }))
vi.mock('@/project/media-import', () => ({ analyzeAssets: async () => {} }))
vi.mock('@/lib/platform', () => ({
  platform: { isMac: false },
  desktop: {
    capture: {
      sources: async () => {
        lab.asked.list++
        if (lab.hold.list) await new Promise<void>((resolve) => (lab.waiting.list = resolve))
        return [{ id: 'screen:1:0', kind: 'screen', name: 'Entire screen', primary: true }]
      },
      helper: async () => ({ available: false, appAudio: false, cursor: true }),
      arm: async () => {},
      session: () => {},
    },
  },
}))

class Track implements FakeTrack {
  readyState: 'live' | 'ended' = 'live'
  constructor() {
    lab.tracks.push(this)
  }
  stop() {
    this.readyState = 'ended'
  }
  clone() {
    return new Track()
  }
  async applyConstraints() {}
  addEventListener() {}
  removeEventListener() {}
}
class Stream {
  constructor(readonly tracks: Track[] = [new Track()]) {}
  get active() {
    return this.tracks.some((t) => t.readyState === 'live')
  }
  getTracks = () => this.tracks
  getVideoTracks = () => this.tracks
  getAudioTracks = () => []
}
vi.stubGlobal('MediaStream', Stream)
vi.stubGlobal(
  'MediaStreamTrackProcessor',
  class {
    readable = { getReader: () => ({ read: async () => ({ value: undefined }), cancel: async () => {} }) }
  },
)
vi.stubGlobal('navigator', {
  mediaDevices: {
    getDisplayMedia: async () => {
      lab.asked.picture++
      if (lab.hold.picture) await new Promise<void>((resolve) => (lab.waiting.picture = resolve))
      return new Stream()
    },
  },
})

const { closeRecorder, openRecorder, useRecorder } = await import('./recorder')

const settle = (ms = 20) => new Promise((r) => setTimeout(r, ms))
const until = async (what: () => boolean) => {
  for (let i = 0; i < 500 && !what(); i++) await settle(2)
  expect(what()).toBe(true)
}
/** Pictures still being captured: a stream, a copy of one for looking at, or one being measured. */
const live = () => lab.tracks.filter((t) => t.readyState === 'live').length

beforeEach(async () => {
  closeRecorder()
  lab.waiting.list?.()
  lab.waiting.picture?.()
  await settle()
  closeRecorder()
  Object.assign(lab, { tracks: [], hold: { list: false, picture: false }, waiting: { list: null, picture: null }, asked: { list: 0, picture: 0 } })
})

describe('the record window’s live picture', () => {
  it('is captured while the window is open, and let go of when it closes', async () => {
    void openRecorder()
    await until(() => useRecorder.getState().stream !== null)
    expect(useRecorder.getState().stream!.active).toBe(true)
    expect(live()).toBeGreaterThan(0)
    closeRecorder()
    await settle()
    expect(useRecorder.getState().stream).toBeNull()
    expect(live()).toBe(0)
  })

  it('isn’t started after all when the window was closed while what can be recorded was still being listed', async () => {
    lab.hold.list = true
    void openRecorder()
    await until(() => lab.waiting.list !== null)
    closeRecorder()
    lab.waiting.list!()
    await settle()
    expect(useRecorder.getState().stream).toBeNull()
    expect(live()).toBe(0)
  })

  it('is let go of when the window was closed while Chromium was still being asked for it', async () => {
    lab.hold.picture = true
    void openRecorder()
    await until(() => lab.waiting.picture !== null)
    closeRecorder()
    lab.waiting.picture!()
    await settle()
    expect(useRecorder.getState().stream).toBeNull()
    expect(live()).toBe(0)
  })

  it('comes up when the window is opened again straight after being closed', async () => {
    lab.hold.picture = true
    void openRecorder()
    await until(() => lab.waiting.picture !== null)
    const first = lab.waiting.picture!
    closeRecorder()
    lab.hold.picture = false
    void openRecorder()
    await until(() => lab.asked.picture === 2)
    first()
    await until(() => useRecorder.getState().stream !== null)
    await settle()
    expect(useRecorder.getState().open).toBe(true)
    expect(useRecorder.getState().stream!.active).toBe(true)
    // One picture, with its copy for looking at: the one asked for before the window closed was let go of.
    expect(live()).toBe(2)
  })
})
