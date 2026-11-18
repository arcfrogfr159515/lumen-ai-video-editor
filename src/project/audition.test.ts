import { beforeEach, describe, expect, it, vi } from 'vitest'

// No speakers here: a sound is a stand-in that says whether it is sounding, and an effect is rendered when the test says so.
const sound = vi.hoisted(() => ({ sounding: [] as string[], ready: new Map<string, () => void>() }))

class Source {
  buffer: { id: string } | null = null
  onended: (() => void) | null = null
  connect() {}
  start() {
    sound.sounding.push(this.buffer!.id)
  }
  stop() {
    const at = sound.sounding.indexOf(this.buffer!.id)
    if (at >= 0) sound.sounding.splice(at, 1)
    queueMicrotask(() => this.onended?.())
  }
}
class Context {
  currentTime = 0
  destination = {}
  createGain = () => ({ gain: { value: 0, setTargetAtTime: () => {} }, connect: () => {} })
  createBufferSource = () => new Source()
}

vi.mock('sonner', () => ({ toast: Object.assign(() => {}, { error: () => {}, success: () => {} }) }))
vi.mock('@/editor/playback', () => ({ monitorLevel: () => 1, onMonitorChange: () => () => {} }))
vi.mock('@/engine/sfx', () => ({
  SFX: ['whoosh', 'pop', 'riser', 'click', 'boom', 'chime'].map((id) => ({ id, name: id })),
  // Rendering takes a moment the first time an effect is asked for: here, until the test calls `ready`.
  renderSfx: (def: { id: string }) => new Promise((resolve) => sound.ready.set(def.id, () => resolve({ id: def.id }))),
}))
vi.stubGlobal('AudioContext', Context)

const { auditionSfx, stopAudition } = await import('./audio-library')

const settle = () => new Promise((r) => setTimeout(r, 0))
async function ready(id: string) {
  sound.ready.get(id)!()
  await settle()
}

beforeEach(() => {
  stopAudition()
  sound.sounding.length = 0
})

describe('listening to a sound effect', () => {
  it('plays it, and the next one in its place', async () => {
    void auditionSfx('whoosh')
    await ready('whoosh')
    expect(sound.sounding).toEqual(['whoosh'])
    void auditionSfx('pop')
    await ready('pop')
    expect(sound.sounding).toEqual(['pop'])
    stopAudition()
    expect(sound.sounding).toEqual([])
  })

  it('plays nothing that was stopped before it was ready', async () => {
    // Play, then Stop at once — a double click on the button. There was no sound yet to stop, and when the effect
    // had been rendered it played all the same, with the button saying nothing was playing.
    void auditionSfx('riser')
    stopAudition()
    await ready('riser')
    expect(sound.sounding).toEqual([])
  })

  it('plays only the last of two asked for before either was ready', async () => {
    // Each stopped what was sounding when it was asked for — nothing yet — and both played, one over the other;
    // only the second could then be stopped.
    void auditionSfx('click')
    void auditionSfx('boom')
    await ready('click')
    await ready('boom')
    expect(sound.sounding).toEqual(['boom'])
    stopAudition()
    expect(sound.sounding).toEqual([])
  })

  it('says when an effect has played to its end', async () => {
    let ended = 0
    void auditionSfx('chime', () => ended++)
    await ready('chime')
    expect(sound.sounding).toEqual(['chime'])
    stopAudition()
    await settle()
    expect(ended).toBe(1)
  })
})
