import { beforeEach, describe, expect, it, vi } from 'vitest'

// The window speaks Chinese here. Its language is settled as the interface's modules load, from what the user chose.
vi.stubGlobal('localStorage', { getItem: (key: string) => (key === 'lumen.language' ? 'zh-CN' : null), setItem: () => {}, removeItem: () => {} })

const { language } = await import('@/lib/i18n')
const { addAsset, freshProject, run } = await import('./test-helpers')
const { getProject } = await import('./store')
const { cancelRecording, startRecording, stopRecording, useMacros } = await import('./macro-store')

let clip = ''
/** Lets the recorder note where in history its steps landed (it does so in a microtask). */
const settle = () => new Promise<void>((resolve) => queueMicrotask(resolve))

/** Records one edit to the clip and saves it as a macro under `name` — or under none. */
async function saved(name?: string) {
  startRecording(clip)
  run('clip.update', { ids: [clip], patch: { color: { contrast: 10 + useMacros.getState().macros.length } } })
  await settle()
  return stopRecording(name)!.name
}

beforeEach(() => {
  cancelRecording()
  useMacros.setState({ macros: [], lastId: null })
  freshProject('旅行短片')
  addAsset('footage', 60)
  const overlay = getProject().tracks.find((t) => t.kind === 'video' && !t.role)!.id
  clip = run('clip.add', { trackId: overlay, kind: 'video', start: 0, duration: 90, assetId: 'footage' }) as string
})

describe('a macro saved without a name', () => {
  it('is named in the window’s language, the second and third as the first is', async () => {
    expect(language).toBe('zh-CN')
    // The first was "宏"; from the second on the name was put together with the English word: "Macro 2".
    expect([await saved(), await saved(), await saved('  ')]).toEqual(['宏', '宏 2', '宏 3'])
  })

  it('keeps the name it is given, with a number when the name is taken', async () => {
    expect([await saved('调色'), await saved('调色'), await saved('Macro')]).toEqual(['调色', '调色 2', 'Macro'])
  })
})
