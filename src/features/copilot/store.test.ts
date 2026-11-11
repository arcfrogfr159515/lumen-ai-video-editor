import { afterAll, describe, expect, it, vi } from 'vitest'

// The desktop app: there is a bridge to the main process, so the store opens the first project's chats as it loads.
const asked: string[] = []
vi.mock('@/integrations/store', () => ({
  api: {
    ai: {
      loadChats: async (projectId: string) => {
        asked.push(projectId)
        return [{ id: 'conv_1', title: 'Earlier', createdAt: 1, updatedAt: 2, messages: [{ id: 'm1', role: 'user', text: 'Tighten the intro' }] }]
      },
      saveChats: async () => {},
    },
  },
}))
vi.mock('sonner', () => ({ toast: Object.assign(() => {}, { error: () => {}, success: () => {}, warning: () => {} }) }))
vi.mock('@/editor/playback', () => ({ playback: { pause: () => {}, seek: () => {} }, usePlayback: { getState: () => ({ frame: 0 }), subscribe: () => () => {} } }))
vi.stubGlobal('window', { addEventListener: () => {}, removeEventListener: () => {} })

const rejections: unknown[] = []
const onRejection = (err: unknown) => void rejections.push(err)
process.on('unhandledRejection', onRejection)
afterAll(() => void process.off('unhandledRejection', onRejection))

// Loaded here rather than in the test: the store brings half the editor with it, and that isn't what is being timed.
const { useEditor } = await import('@/editor/store')
const { useAttachments, useCopilot } = await import('./store')

describe('the Copilot’s chats', () => {
  it('are opened for the project that is there when the app starts', async () => {
    await new Promise((r) => setTimeout(r, 20))
    // Opening the first project's chats used to stop at a store that wasn't made yet: nothing was opened, and the
    // error went unhandled on every start.
    expect(rejections).toEqual([])
    const id = useEditor.getState().project.id
    expect(asked).toEqual([id])
    expect(useCopilot.getState()).toMatchObject({ projectId: id, conversationId: 'conv_1' })
    expect(useCopilot.getState().messages.map((m) => m.text)).toEqual(['Tighten the intro'])
    expect(useAttachments.getState().items).toEqual([])
  })
})
