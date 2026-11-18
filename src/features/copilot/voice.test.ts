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

const { abandonVoice, useVoiceInput } = await import('./voice')

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
  abandonVoice()
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

  it('lets go of the microphone when its button goes away while it records, and the next button works', async () => {
    button().toggle()
    microphone()
    await settle()
    expect(lab.streams.map((s) => s.live)).toEqual([true])
    // The Copilot's panel is switched away (the Inspector opens): the button is taken down. Left as it was, the
    // recording went on with the microphone open, and the button drawn when the panel came back did nothing.
    abandonVoice()
    await settle()
    expect({ recording: lab.recorders.filter((r) => r.state === 'recording').length, microphonesLeftOpen: lab.streams.filter((s) => s.live).length }).toEqual({ recording: 0, microphonesLeftOpen: 0 })
    // What was being said is let go with it: there is nobody left to hand the words to.
    expect(lab.heard).toEqual([])
    button().toggle()
    microphone()
    await settle()
    expect(lab.recorders.map((r) => r.state)).toEqual(['inactive', 'recording'])
  })

  it('doesn’t start recording for a button that went away while the microphone was being asked for', async () => {
    button().toggle()
    abandonVoice()
    microphone()
    await settle()
    expect({ recorders: lab.recorders.length, microphonesLeftOpen: lab.streams.filter((s) => s.live).length }).toEqual({ recorders: 0, microphonesLeftOpen: 0 })
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
