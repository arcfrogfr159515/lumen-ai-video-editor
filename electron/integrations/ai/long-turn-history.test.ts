import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent, AgentRunRequest } from '../../../shared/ai'

// A turn that did a lot — twenty tool calls and more — and what the Copilot remembers of it in the turn after.

const env = vi.hoisted(() => ({ root: '', events: [] as unknown[], requests: [] as Record<string, any>[], replies: [] as string[] }))

vi.mock('electron', () => ({ app: { getPath: (name: string) => path.join(env.root, name), getVersion: () => '9.9.9' } }))

vi.mock('../editor-rpc', () => ({
  editorWindow: () => ({ webContents: { send: (_channel: string, e: unknown) => void env.events.push(e) } }),
  editorTools: async () => [{ name: 'get_project', description: 'The project.', inputSchema: { type: 'object', properties: {} } }],
  callEditorTool: async () => ({ content: [{ type: 'text', text: '{"fps":30,"clips":2}' }] }),
}))

vi.mock('./local-agents', () => ({ runLocal: vi.fn(), stopLocal: vi.fn(), stopAllLocal: vi.fn(), forgetLocalSession: vi.fn() }))

vi.mock('./providers', async () => {
  const { createAnthropic } = await import('@ai-sdk/anthropic')
  const fetch = async (_url: unknown, init?: { body?: unknown }) => {
    env.requests.push(JSON.parse(String(init?.body)))
    return new Response(env.replies.shift() ?? '', { status: 200, headers: { 'content-type': 'text/event-stream' } })
  }
  return {
    MissingKeyError: class extends Error {},
    languageModel: async (_provider: string, modelId: string) => ({ model: createAnthropic({ apiKey: 'test', fetch: fetch as typeof globalThis.fetch })(modelId), api: 'anthropic' }),
  }
})

env.root = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-long-turn-test-'))
const { startAgentRun, trim } = await import('./agent')

afterAll(() => fs.rmSync(env.root, { recursive: true, force: true }))

beforeEach(() => {
  env.events.length = 0
  env.requests.length = 0
  env.replies.length = 0
})

/** One answer from the stand-in for Anthropic's API: a tool call, or the last words of a turn. */
function reply(block: { text: string } | { tool: string; id: string }) {
  const events: unknown[] = [
    { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 1 } } },
  ]
  if ('text' in block) {
    events.push({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
    events.push({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: block.text } })
  } else {
    events.push({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: block.id, name: block.tool, input: {} } })
    events.push({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{}' } })
  }
  events.push({ type: 'content_block_stop', index: 0 })
  events.push({ type: 'message_delta', delta: { stop_reason: 'text' in block ? 'end_turn' : 'tool_use', stop_sequence: null }, usage: { output_tokens: 5 } })
  events.push({ type: 'message_stop' })
  return events.map((e) => `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`).join('')
}

async function turn(req: Partial<AgentRunRequest> & { runId: string; prompt: string; conversationId: string }) {
  await startAgentRun({ target: { kind: 'model', provider: 'anthropic', model: 'claude-opus-5-5' }, ...req })
  for (let i = 0; i < 1000; i++) {
    const end = (env.events as AgentEvent[]).find((e) => e.runId === req.runId && (e.type === 'done' || e.type === 'error'))
    if (end) return (env.events as AgentEvent[]).filter((e) => e.runId === req.runId)
    await new Promise((r) => setTimeout(r, 10))
  }
  throw new Error('The turn never finished.')
}

/** Everything a request's conversation says, as one text. */
const said = (request: Record<string, any>) => JSON.stringify(request.messages)

describe('a turn of many tool calls', () => {
  it('is remembered when it stopped at its fortieth step and the user says “continue”', async () => {
    for (let i = 0; i < 40; i++) env.replies.push(reply({ tool: 'get_project', id: `toolu_${i}` }))
    const first = await turn({ runId: 'run_long', conversationId: 'conv_long', prompt: 'Tighten every cut in the film' })
    expect(env.requests).toHaveLength(40)
    // What the chat is told: say “continue”, and it carries on from here.
    expect(first.find((e) => e.type === 'note')).toMatchObject({ message: expect.stringContaining('continue') })

    env.requests.length = 0
    env.replies.push(reply({ text: 'Carrying on.' }))
    await turn({ runId: 'run_next', conversationId: 'conv_long', prompt: 'continue' })
    const [next] = env.requests
    // The request before it and what was done for it are there to carry on from. (Nothing was: the turn alone was
    // longer than what is kept, the cut looked for the start of a later turn, found none and kept nothing.)
    expect(said(next)).toContain('Tighten every cut in the film')
    expect(said(next)).toContain('toolu_39')
    expect(next.messages.at(-1).content.at(-1).text).toBe('continue')
    expect(next.messages.length).toBeGreaterThan(40)
  })

  it('is remembered after a conversation that was already long', async () => {
    // Twenty short turns first: forty messages.
    for (let i = 0; i < 20; i++) {
      env.replies.push(reply({ text: `Answer ${i}.` }))
      await turn({ runId: `run_short_${i}`, conversationId: 'conv_grown', prompt: `Question ${i}` })
    }
    // Then one of twenty-five tool calls and a last word: fifty-two messages, and ninety-two in all.
    for (let i = 0; i < 25; i++) env.replies.push(reply({ tool: 'get_project', id: `toolu_b${i}` }))
    env.replies.push(reply({ text: 'All tightened.' }))
    await turn({ runId: 'run_big', conversationId: 'conv_grown', prompt: 'Tighten every cut in the film' })

    env.requests.length = 0
    env.replies.push(reply({ text: 'The third one.' }))
    await turn({ runId: 'run_after', conversationId: 'conv_grown', prompt: 'Which cut moved the most?' })
    const [next] = env.requests
    expect(said(next)).toContain('Tighten every cut in the film')
    expect(said(next)).toContain('All tightened.')
    // The older turns went, as they do once a conversation is long: it starts at the request of the long turn.
    expect(said(next)).not.toContain('Question 19')
    expect(next.messages[0].role).toBe('user')
    expect(JSON.stringify(next.messages[0])).toContain('Tighten every cut in the film')
  })
})

describe('cutting a long conversation back', () => {
  const user = (text: string) => ({ role: 'user' as const, content: text })
  const assistant = (text: string) => ({ role: 'assistant' as const, content: text })
  /** A turn of `calls` tool calls: the request, then a call and its result for each. */
  const working = (text: string, calls: number) => [
    user(text),
    ...Array.from({ length: calls }, (_, i) => [
      { role: 'assistant' as const, content: [{ type: 'tool-call' as const, toolCallId: `${text}_${i}`, toolName: 'get_project', input: {} }] },
      { role: 'tool' as const, content: [{ type: 'tool-result' as const, toolCallId: `${text}_${i}`, toolName: 'get_project', output: { type: 'text' as const, value: '{}' } }] },
    ]).flat(),
  ]

  it('keeps the last turn whole when it alone is longer than what is kept', () => {
    const alone = working('long', 40)
    expect(alone).toHaveLength(81)
    expect(trim(alone)).toEqual(alone)

    const after = [...Array.from({ length: 15 }, (_, i) => [user(`q${i}`), assistant(`a${i}`)]).flat(), ...working('long', 30)]
    expect(after).toHaveLength(91)
    const cut = trim(after)
    expect(cut).toEqual(working('long', 30))
  })

  it('still cuts at the first request among the last forty messages when there is one', () => {
    const history = [...working('long', 30), user('q1'), assistant('a1'), user('q2'), assistant('a2'), ...Array.from({ length: 10 }, (_, i) => [user(`r${i}`), assistant(`b${i}`)]).flat()]
    expect(history).toHaveLength(85)
    const cut = trim(history)
    expect(cut.length).toBeLessThanOrEqual(40)
    expect(cut[0].role).toBe('user')
    expect(cut.at(-1)).toBe(history.at(-1))
    // Calls and their results stay together: no result is left without the call before it.
    expect(cut.some((m) => m.role === 'tool')).toBe(false)
  })
})
