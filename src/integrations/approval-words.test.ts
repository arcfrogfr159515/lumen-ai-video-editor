import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { McpServerState } from '@shared/integrations'

// A window in Chinese.
vi.stubGlobal('localStorage', { getItem: (key: string) => (key === 'lumen.language' ? 'zh-CN' : null), setItem: () => {}, removeItem: () => {} })
vi.mock('sonner', () => ({ toast: Object.assign(() => {}, { error: () => {}, success: () => {}, loading: () => 1, dismiss: () => {} }) }))
// The desktop app is a stand-in: asking is all that happens here, and every question is answered no.
const unreached = async () => {
  throw new Error('The question was answered no: nothing should run.')
}
vi.mock('./store', async (original) => ({ ...(await original<typeof import('./store')>()), api: { mcp: { callForAgent: unreached }, blender: { runLive: unreached } } }))
vi.mock('@/lib/platform', async (original) => ({ ...(await original<typeof import('@/lib/platform')>()), desktop: {} }))
vi.mock('@/engine/stills', () => ({ timelineStills: async () => [], mediaStills: async () => [], contactSheet: () => ({ width: 1248, height: 180 }), canvasBase64: () => 'SlBFRw==' }))

const { language } = await import('@/lib/i18n')
const { runAgentTool } = await import('./agent-tools')
const { useApprovals } = await import('./approvals')
const { useIntegrations } = await import('./store')

/** What the user is asked when an agent runs a tool — answered no. */
async function asked(tool: string, args: Record<string, unknown>) {
  const running = runAgentTool(tool, args)
  await vi.waitFor(() => expect(useApprovals.getState().queue).toHaveLength(1))
  const { title, detail, requester, note, confirm, deny, resolve } = useApprovals.getState().queue[0]
  resolve(false)
  expect((await running).isError).toBe(true)
  return { title, detail, requester, note, confirm, deny }
}

const studio: McpServerState = {
  config: { id: 'studio', name: 'GS Cinematic Studio', transport: 'http', url: 'http://127.0.0.1:30120/gs-cinematic-studio/mcp', enabled: true },
  status: 'connected',
  tools: [{ name: 'delete_project', description: 'Delete a project.', inputSchema: { type: 'object', properties: {} }, annotations: { destructiveHint: true } }],
}

beforeEach(() => {
  useApprovals.setState({ queue: [] })
  useIntegrations.setState({ servers: { studio } })
})

describe('what an agent has to ask the user first, in a window in Chinese', () => {
  it('asks before rendering a scene it wrote in Chinese', async () => {
    expect(language).toBe('zh-CN')
    // The question was written in the tool as English, and shown as written: “Render an AI-written Blender scene?”
    // from “An AI agent” — over what the model says the scene is, which is its own words.
    expect(await asked('render_blender_script', { script: 'import bpy', description: '一个旋转的立方体' })).toMatchObject({ title: '渲染 AI 编写的 Blender 场景吗？', requester: 'AI 代理', detail: '一个旋转的立方体' })
  })

  it('asks before running code in the Blender that is open in Chinese', async () => {
    expect(await asked('blender_live', { code: 'import bpy', description: '列出场景里的物体' })).toMatchObject({ title: '在你打开的 Blender 中运行代码吗？', requester: 'AI 代理' })
  })

  it('asks before running a server’s tool that can’t be undone in Chinese', async () => {
    // What the tool is and does are the server's words; the question around them is Lumen's.
    expect(await asked('studio__delete_project', {})).toMatchObject({ title: '允许 AI 在 GS Cinematic Studio 上运行“delete_project”吗？', requester: 'AI 代理', detail: 'Delete a project.\n\n此操作无法撤销。' })
  })

  it('asks before looking at the screen in Chinese: the question, what allowing it means, and both answers', async () => {
    const question = await asked('list_capture_sources', {})
    expect(question).toEqual({
      title: '允许 AI 查看并录制你的屏幕吗？',
      requester: 'AI',
      detail: '查看可以录制的内容。如果你允许，它可以列出你的屏幕和打开的窗口（附带小图），并录制其中任何一个（含声音），直到你关闭 Lumen。',
      note: '录制内容会保存在这台电脑上并添加到项目中。只要有录制在进行，标题栏就会显示一个红点，你可以在那里停止。',
      confirm: '本次会话允许',
      deny: '不允许',
    })
  })

  it('says what it wants to record in Chinese', async () => {
    expect((await asked('start_recording', { source: 'screen 2' })).detail).toMatch(/^录制“screen 2”。如果你允许，/)
    expect((await asked('start_recording', {})).detail).toMatch(/^录制“屏幕”。如果你允许，/)
  })
})
