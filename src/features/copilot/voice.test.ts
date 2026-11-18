import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// No microphone here: asking for one takes until the test says so (the real one takes a moment, longer the first
// time), and what it hands over can be seen being let go of.
interface FakeStream {
  live: boolean
  getTracks: () => { stop: () => void }[]
}
const lab = vi.hoisted(() => ({
  asked: [] as (() => void)[],
  streams: [] as FakeStream[],
  recorders: [] as { state: string; stop: () => void }[],
  heard: [] as string[],
}))

vi.mock('sonner', () => ({ toast: Object.assign(() => {}, { error: () => {}, success: () => {}, loading: () => 1, dismiss: () => {} }) }))
vi.mock('@/project/transcribe', () => ({ transcribeSpeech: async () => 'cut the silences', transcribers: () => ['local'], TRANSCRIBER_NAMES: { local: 'On this computer' } }))
vi.mock('@/project/whisper', () => ({ onWhisperProgress: () => () => {} }))

class Recorder {
  static isTypeSupported = () => true
  state = 'inactive'
  ondataavailable: ((e: { data: Blob }) => void) | null = null
  onstop: (() => void | Promise<void>) | null = null
  constructor() {
    lab.recorders.push(this)
  }
  start() {
    this.state = 'recording'
  }
  stop() {
    this.state = 'inactive'
    void this.onstop?.()
  }
}
vi.stubGlobal('MediaRecorder', Recorder)
vi.stubGlobal(
  'OfflineAudioContext',
  class {
    decodeAudioData = async () => ({})
  },
)
vi.stubGlobal('navigator', {
  mediaDevices: {
    getUserMedia: () =>
      new Promise<FakeStream>((resolve) =>
        lab.asked.push(() => {
          const stream: FakeStream = { live: true, getTracks: () => [{ stop: () => void (stream.live = false) }] }
          lab.streams.push(stream)
          resolve(stream)
        }),
      ),
  },
})

const { useVoiceInput } = await import('./voice')

const settle = () => new Promise((r) => setTimeout(r, 20))
/** The microphone button as a window has it before anything has been pressed. */
function button() {
  let voice!: ReturnType<typeof useVoiceInput>
  renderToString(
    createElement(() => {
      voice = useVoiceInput((text) => void lab.heard.push(text))
      return null
    }),
  )
  return voice
}
/** The microphone answers everyone who asked for it. */
const microphone = () => {
  for (const answer of lab.asked.splice(0)) answer()
}

beforeEach(async () => {
  microphone()
  await settle()
  for (const r of lab.recorders) if (r.state === 'recording') r.stop()
  await settle()
  Object.assign(lab, { asked: [], streams: [], recorders: [], heard: [] })
})

describe('speaking to the Copilot', () => {
  it('records from the microphone, and lets go of it when the recording stops', async () => {
    button().toggle()
    microphone()
    await settle()
    expect(lab.recorders.map((r) => r.state)).toEqual(['recording'])
    expect(lab.streams.map((s) => s.live)).toEqual([true])
    lab.recorders[0].stop()
    await settle()
    expect(lab.streams.map((s) => s.live)).toEqual([false])
    expect(lab.heard).toEqual(['cut the silences'])
  })

  it('records once when the button is pressed twice before the microphone has answered', async () => {
    const voice = button()
    // A double click: the button still shows “idle”, because the microphone hasn't answered the first press yet.
    voice.toggle()
    voice.toggle()
    microphone()
    await settle()
    const recording = lab.recorders.filter((r) => r.state === 'recording').length
    // Stopping stops the recording the button knows of — and no microphone is left open behind it.
    lab.recorders.at(-1)!.stop()
    await settle()
    expect({ recording, microphonesLeftOpen: lab.streams.filter((s) => s.live).length }).toEqual({ recording: 1, microphonesLeftOpen: 0 })
    expect(lab.heard).toEqual(['cut the silences'])
  })
})
