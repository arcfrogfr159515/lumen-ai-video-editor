import { describe, expect, it, vi } from 'vitest'

// No screen and no encoder here. Listing what can be recorded takes until the test says so — it is what a
// recording started without the record window open (by a tool) waits for first — and the encoder is missing
// altogether, so a recording that gets as far as starting one fails there.
const lab = vi.hoisted(() => ({ listed: null as null | (() => void), asked: { list: 0, picture: 0 } }))

vi.mock('sonner', () => ({ toast: Object.assign(() => {}, { error: () => {}, success: () => {}, loading: () => 1, dismiss: () => {}, warning: () => {} }) }))
vi.mock('@/engine/decode', () => ({ probeMedia: async () => null }))
vi.mock('@/project/media-import', () => ({ analyzeAssets: async () => {} }))
vi.mock('@/lib/platform', () => ({
  platform: { isMac: false },
  desktop: {
    capture: {
      sources: async () => {
        lab.asked.list++
        await new Promise<void>((resolve) => (lab.listed = resolve))
        return [{ id: 'screen:1:0', kind: 'screen', name: 'Entire screen', primary: true }]
      },
      helper: async () => ({ available: false, appAudio: false, cursor: true }),
      arm: async () => {},
      session: () => {},
      startCursor: async () => {},
      stopStream: async () => {},
      discard: async () => {},
      onAudioChunk: () => () => {},
      onCursorEvents: () => () => {},
      onStreamEnded: () => () => {},
      onHotkey: () => () => {},
    },
  },
}))

class Track {
  readyState: 'live' | 'ended' = 'live'
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
      return new Stream()
    },
  },
})

const { startRecording, useRecorder } = await import('./recorder')

const settle = (ms = 20) => new Promise((r) => setTimeout(r, ms))

describe('starting a recording', () => {
  it('is refused while another start is still finding what to record', async () => {
    // Asked for twice at once — a tool's call sent again, a key pressed with it — before the first had got as far
    // as saying a recording was being prepared: both went ahead, and the first was left running with nothing to stop it by.
    const settings = { sourceId: 'screen:1:0', audio: 'off' as const, cursorData: false, countdown: 0 }
    const first = startRecording({ settings }).then(
      () => 'started',
      (err: Error) => err.message,
    )
    const second = startRecording({ settings }).then(
      () => 'started',
      (err: Error) => err.message,
    )
    await settle()
    lab.listed?.()
    await settle()
    lab.listed?.()
    expect(await second).toBe('A recording is already running. Stop it first.')
    // The first gets as far as its encoder, which isn't there in a test: it is the only one to have asked for the picture.
    expect(await first).not.toBe('A recording is already running. Stop it first.')
    expect(lab.asked.picture).toBe(1)
    expect(useRecorder.getState().phase).toBe('idle')
  })
})
