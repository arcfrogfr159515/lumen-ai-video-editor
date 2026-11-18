import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

// No microphone here: the browser's recording parts are stand-ins.
class Stream {
  getTracks = () => [{ stop: () => {} }]
}
class Context {
  state = 'running'
  createAnalyser = () => ({ fftSize: 0 })
  createMediaStreamSource = () => ({ connect: () => {} })
  async close() {
    this.state = 'closed'
  }
}
class Recorder {
  static isTypeSupported = () => true
  state = 'inactive'
  onstop: (() => void) | null = null
  start() {
    this.state = 'recording'
  }
  stop() {
    this.state = 'inactive'
  }
}
vi.mock('sonner', () => ({ toast: Object.assign(() => {}, { error: () => {}, success: () => {} }) }))
vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: async () => new Stream() } })
vi.stubGlobal('AudioContext', Context)
vi.stubGlobal('MediaRecorder', Recorder)
vi.stubGlobal('requestAnimationFrame', () => 0)
vi.stubGlobal('cancelAnimationFrame', () => {})

const { cancelRecording, startRecording } = await import('@/project/audio-library')
const { AudioPanel } = await import('./AudioPanel')

/** The Audio panel as it is drawn when its tab is opened. */
const panel = () => renderToString(createElement(AudioPanel))

describe('the voiceover card of the Audio panel', () => {
  it('offers to record when nothing is being recorded', () => {
    expect(panel()).toContain('Record a voiceover')
    expect(panel()).not.toContain('Stop &amp; add')
  })

  it('takes up a recording that is running when the panel is opened again', async () => {
    // Started, then another tab was opened: the card that started it is gone. Drawn anew, it used to offer to record
    // (a second microphone) while the first went on recording with nothing left to stop it by.
    const rec = await startRecording(undefined, 30)
    expect(panel()).toContain('Stop &amp; add')
    expect(panel()).not.toContain('Record a voiceover')
    cancelRecording(rec)
    expect(panel()).toContain('Record a voiceover')
  })
})
