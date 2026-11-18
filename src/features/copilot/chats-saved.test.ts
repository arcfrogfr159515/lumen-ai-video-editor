import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

// The desktop app's side is a stand-in: chats are "written" into a list — or refused, when the test says so.
const disk = vi.hoisted(() => ({ refuse: null as null | string, written: [] as unknown[][], told: [] as string[] }))

vi.mock('sonner', () => ({
  toast: Object.assign(() => {}, {
    error: (title: string, opts?: { description?: string }) => void disk.told.push(`${title} — ${opts?.description ?? ''}`),
    warning: (title: string, opts?: { description?: string }) => void disk.told.push(`${title} — ${opts?.description ?? ''}`),
    success: () => {},
    loading: () => 1,
    dismiss: () => {},
  }),
}))
const none = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
vi.stubGlobal('localStorage', none)
vi.stubGlobal('window', {
  localStorage: none,
  addEventListener: () => {},
  lumen: {
    integrations: {
      ai: {
        loadChats: async () => [],
        saveChats: async (_projectId: string, chats: unknown[]) => {
          // As it arrives from the main process: wrapped in what was being called.
          if (disk.refuse) throw new Error(`Error invoking remote method 'lumen:ai:saveChats': Error: ${disk.refuse}`)
          disk.written.push(chats)
        },
        detach: async () => {},
        forget: async () => {},
        stop: async () => {},
        onEvent: () => {},
      },
    },
  },
})

const { useCopilot } = await import('./store')

let n = 0
/** Says something in the open chat, and waits past the moment chats are written. */
async function say(text: string) {
  useCopilot.setState((s) => ({ messages: [...s.messages, { id: `m${++n}`, role: 'user' as const, text, createdAt: n }] }))
  await vi.advanceTimersByTimeAsync(1000)
}

beforeAll(async () => {
  vi.useFakeTimers()
  await vi.advanceTimersByTimeAsync(10)
})
afterAll(() => void vi.useRealTimers())

describe('chats that can’t be written to disk', () => {
  it('are said to be unsaved — once, until they can be written again', async () => {
    await say('Trim the first clip')
    expect(disk.written).toHaveLength(1)
    expect(disk.told).toEqual([])

    // The main process refuses chats past a size, with a sentence written for the user — and the window dropped
    // whatever went wrong with a save without a word: from then on nothing was kept, and nothing said so.
    disk.refuse = 'These chats are too large to keep — delete some old ones.'
    await say('And the second')
    expect(disk.told).toEqual(['Your chats couldn’t be saved — These chats are too large to keep — delete some old ones.'])
    // Every change is another try; it is said once, not at each of them.
    await say('And the third')
    await say('And the fourth')
    expect(disk.told).toHaveLength(1)

    // Written again, and then not: that is news again.
    disk.refuse = null
    await say('Deleted some old ones')
    expect(disk.written).toHaveLength(2)
    disk.refuse = 'ENOSPC: no space left on device'
    await say('One more')
    expect(disk.told).toHaveLength(2)
    expect(disk.told[1]).toBe('Your chats couldn’t be saved — ENOSPC: no space left on device')
  })
})
