import { beforeEach, describe, expect, it, vi } from 'vitest'

// No speech recognition here: transcribing ends when the test says so — in the app it takes minutes — and gives
// each media item it was asked for a transcript, as the real one does.
const speech = vi.hoisted(() => ({ done: () => {} }))
vi.mock('@/project/transcribe', async (original) => ({
  ...(await original<typeof import('@/project/transcribe')>()),
  ensureTranscripts: (ids: string[]) =>
    new Promise<boolean>((resolve) => {
      speech.done = () => {
        for (const id of ids) heard(id)
        resolve(true)
      }
    }),
}))

const said = vi.hoisted(() => ({ plain: [] as string[], success: [] as string[] }))
vi.mock('sonner', () => ({
  toast: Object.assign((text: string) => void said.plain.push(text), {
    success: (text: string) => void said.success.push(text),
    error: () => {},
    loading: () => 'working',
    message: () => {},
    dismiss: () => {},
  }),
}))

const { runAgentTool } = await import('./agent-tools')
const { actions } = await import('@/features/shell/actions')
const { add, addAsset, freshProject, onTrack, run, transcript } = await import('@/editor/test-helpers')
const { getProject } = await import('@/editor/store')
const { addCaptions } = await import('@/editor/smart')
const { openSequenceId } = await import('@/editor/sequences')

function heard(assetId: string) {
  if (getProject().assets[assetId]) run('asset.update', { id: assetId, patch: { transcript: transcript([0.5, 2, 'we drove up to the mountains'], [3, 5, 'the light was perfect']) } })
}
const settle = () => new Promise((r) => setTimeout(r, 0))
const captions = () =>
  Object.values(getProject().clips)
    .filter((c) => c.kind === 'text')
    .sort((a, b) => a.start - b.start)
    .map((c) => c.text?.content)
async function ask() {
  const res = await runAgentTool('add_captions', {})
  const text = res.content.find((c) => c.type === 'text')
  return res.isError ? { error: text && 'text' in text ? text.text : '' } : (res.structuredContent as { captions_added: number })
}

let film = ''
let teaser = ''
beforeEach(() => {
  freshProject('Film')
  film = openSequenceId(getProject())
  // The film: an interview nobody has transcribed yet.
  addAsset('interview', 10, 'audio')
  add('Voice', 0, 300, { assetId: 'interview' })
  // Its teaser, on a timeline of its own: transcribed, captioned, and one caption put right by hand.
  addAsset('promo', 10, 'audio', { transcript: transcript([0.5, 2, 'coming this summer'], [3, 5, 'a film about light']) })
  teaser = run('sequence.create', { name: 'Teaser', open: true }) as string
  add('Voice', 0, 300, { assetId: 'promo' })
  addCaptions({ source: 'user' })
  const first = Object.values(getProject().clips).find((c) => c.kind === 'text')!
  run('clip.update', { ids: [first.id], patch: { text: { content: 'Coming this summer —' } } })
  run('sequence.open', { id: film })
  said.plain.length = 0
  said.success.length = 0
})

describe('captions asked for from the menu, on a timeline whose speech has to be transcribed first', () => {
  it('are laid on that timeline when the speech has been transcribed', async () => {
    const asked = actions.captionSpeech()
    await settle()
    speech.done()
    await asked
    expect(captions()).toEqual(['we drove up to the mountains', 'the light was perfect'])
    expect(said.success).toEqual(['Added 2 captions'])
  })

  it('are not laid on another timeline that was opened while it was being transcribed, and it says so', async () => {
    const asked = actions.captionSpeech()
    await settle()
    run('sequence.open', { id: teaser })
    const before = captions()
    speech.done()
    await asked
    expect(captions()).toEqual(before)
    expect(said.success).toEqual([])
    expect(said.plain).toEqual(['No captions were added'])
  })
})

describe('captions asked for on a timeline whose speech has to be transcribed first', () => {
  it('are laid on that timeline when the speech has been transcribed', async () => {
    const asked = ask()
    await settle()
    speech.done()
    expect(await asked).toMatchObject({ captions_added: 2 })
    expect(captions()).toEqual(['we drove up to the mountains', 'the light was perfect'])
    expect(onTrack('Voice')).toHaveLength(1)
  })

  it('are not laid on another timeline that was opened while it was being transcribed', async () => {
    const asked = ask()
    await settle()
    // While the interview is transcribed, the user opens the teaser.
    run('sequence.open', { id: teaser })
    const before = captions()
    expect(before[0]).toBe('Coming this summer —')
    speech.done()
    // The captions went onto whatever timeline was open by then: the teaser's own, the one put right by hand
    // with them, were replaced, and the film had none.
    expect(await asked).toEqual({ error: expect.stringMatching(/another timeline is open/) })
    expect(captions()).toEqual(before)
    // The speech is transcribed by now: asked again on the film, the captions are there at once.
    run('sequence.open', { id: film })
    expect(captions()).toEqual([])
    expect(await ask()).toMatchObject({ captions_added: 2 })
    expect(captions()).toEqual(['we drove up to the mountains', 'the light was perfect'])
  })

  it('are not laid on another project that was opened meanwhile', async () => {
    const asked = ask()
    await settle()
    freshProject('Another film')
    addAsset('speech', 10, 'audio', { transcript: transcript([0.5, 2, 'thank you all for coming']) })
    add('Voice', 0, 300, { assetId: 'speech' })
    speech.done()
    expect(await asked).toEqual({ error: expect.stringMatching(/another timeline is open/) })
    expect(captions()).toEqual([])
  })
})
