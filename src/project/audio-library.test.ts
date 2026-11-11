import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// No microphone here: the browser's recording parts are stand-ins that say what was done to them.
const mic = { live: 0, contexts: 0, failAt: '' as '' | 'context' | 'recorder' | 'start' | 'stop', recorderState: 'recording' as 'recording' | 'inactive' }

class Track {
  stopped = false
  constructor() {
    mic.live++
  }
  stop() {
    if (!this.stopped) mic.live--
    this.stopped = true
  }
}
class Stream {
  tracks = [new Track()]
  getTracks = () => this.tracks
}
class Context {
  state = 'running'
  constructor() {
    if (mic.failAt === 'context') throw new Error('The audio device is in use.')
    mic.contexts++
  }
  createAnalyser = () => ({ fftSize: 0 })
  createMediaStreamSource = () => ({ connect: () => {} })
  async close() {
    if (this.state === 'closed') throw new Error('InvalidStateError')
    this.state = 'closed'
    mic.contexts--
  }
}
class Recorder {
  static isTypeSupported = () => true
  state = 'inactive'
  onstop: (() => void) | null = null
  onerror: (() => void) | null = null
  ondataavailable: ((e: { data: { size: number } }) => void) | null = null
  constructor() {
    if (mic.failAt === 'recorder') throw new Error('NotSupportedError: the microphone’s format can’t be recorded')
  }
  start() {
    if (mic.failAt === 'start') throw new Error('InvalidStateError: the track has ended')
    this.state = mic.recorderState
  }
  stop() {
    if (this.state === 'inactive') throw new Error('InvalidStateError: the recorder is not recording')
    if (mic.failAt === 'stop') throw new Error('UnknownError')
    this.state = 'inactive'
    queueMicrotask(() => this.onstop?.())
  }
}

vi.mock('sonner', () => ({ toast: Object.assign(() => {}, { error: () => {}, success: () => {} }) }))
vi.mock('@/editor/playback', () => ({ monitorLevel: () => 0, onMonitorChange: () => () => {} }))
vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: async () => new Stream() } })
vi.stubGlobal('AudioContext', Context)
vi.stubGlobal('MediaRecorder', Recorder)

const { cancelRecording, finishRecording, startRecording } = await import('./audio-library')

beforeEach(() => {
  Object.assign(mic, { live: 0, contexts: 0, failAt: '', recorderState: 'recording' })
})
afterEach(() => expect(mic).toMatchObject({ live: 0, contexts: 0 }))

describe('recording from the microphone', () => {
  it('holds the microphone while it records, and lets it go when cancelled', async () => {
    const rec = await startRecording()
    expect(mic).toMatchObject({ live: 1, contexts: 1 })
    cancelRecording(rec)
    // Cancelling twice (the dialog closing after the button) is harmless.
    cancelRecording(rec)
  })

  it('lets the microphone go when recording can’t be set up', async () => {
    for (const failAt of ['context', 'recorder', 'start'] as const) {
      mic.failAt = failAt
      await expect(startRecording('usb-mic')).rejects.toThrow()
      // The microphone was already on when it failed: its light must go out again.
      expect(mic, failAt).toMatchObject({ live: 0, contexts: 0 })
    }
  })

  it('lets the microphone go when it finishes', async () => {
    const rec = await startRecording()
    expect(await finishRecording(rec, 'Take 1')).toBeNull()
  })

  it('lets the microphone go when the recorder had already stopped by itself', async () => {
    // The microphone was unplugged: the recorder is no longer recording, and asking it to stop throws.
    mic.recorderState = 'inactive'
    const rec = await startRecording()
    expect(await finishRecording(rec, 'Take 1')).toBeNull()
  })

  it('lets the microphone go when stopping fails', async () => {
    const rec = await startRecording()
    mic.failAt = 'stop'
    await expect(finishRecording(rec, 'Take 1')).rejects.toThrow('UnknownError')
    expect(mic).toMatchObject({ live: 0, contexts: 0 })
    const other = await startRecording()
    expect(() => cancelRecording(other)).toThrow('UnknownError')
  })
})
