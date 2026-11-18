import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '../../../shared/ai'

// A reply the Copilot is writing, and the editor's page going away under it: reloaded after a crash, or closed.
// The turn runs in this process, and went on there — asking the model, and calling its tools on whatever project
// the page that came next had open — with nothing in the new page to show it, or to stop it.

const env = vi.hoisted(() => ({
  root: '',
  ipc: null as unknown as import('node:events').EventEmitter,
  /** Requests to the model that are waiting for an answer, and those that were given up. */
  asked: 0,
  ended: 0,
  stoppedLocal: 0,
}))

vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  const nodePath = await import('node:path')
  env.ipc = new EventEmitter()
  return { ipcMain: env.ipc, BrowserWindow: class {}, app: { getPath: (name: string) => nodePath.join(env.root, name), getVersion: () => '9.9.9' } }
})

vi.mock('./local-agents', () => ({ runLocal: vi.fn(), stopLocal: vi.fn(), stopAllLocal: () => void env.stoppedLocal++, forgetLocalSession: vi.fn() }))

vi.mock('./providers', async () => {
  const { createAnthropic } = await import('@ai-sdk/anthropic')
  // The model never answers: the request stays open until it is given up.
  const fetch = (_url: unknown, init?: { signal?: AbortSignal }) =>
    new Promise<Response>((_resolve, reject) => {
      env.asked++
      init?.signal?.addEventListener('abort', () => {
        env.ended++
        reject(new DOMException('Aborted', 'AbortError'))
      })
    })
  return {
    MissingKeyError: class extends Error {},
    languageModel: async (_provider: string, modelId: string) => ({ model: createAnthropic({ apiKey: 'test', fetch: fetch as typeof globalThis.fetch })(modelId), api: 'anthropic' }),
  }
})

env.root = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-agent-gone-'))
const { startAgentRun } = await import('./agent')
const { initEditorRpc } = await import('../editor-rpc')
const { IPC } = await import('../../../shared/integrations')

afterAll(() => fs.rmSync(env.root, { recursive: true, force: true }))

/** The editor's page: it keeps what it is sent — the calls into it, and what the chat is told. */
class Page extends EventEmitter {
  calls: { id: string; method: string }[] = []
  told: AgentEvent[] = []
  send(channel: string, payload: unknown) {
    if (channel === IPC.bridgeRequest) this.calls.push(payload as { id: string; method: string })
    if (channel === IPC.aiEvent) this.told.push(payload as AgentEvent)
  }
}
class Window extends EventEmitter {
  webContents = new Page()
  destroyed = false
  isDestroyed = () => this.destroyed
}

const until = async (what: () => boolean, ms = 2000) => {
  for (let waited = 0; waited < ms; waited += 5) {
    if (what()) return true
    await new Promise((r) => setTimeout(r, 5))
  }
  return what()
}

let win: Window
let n = 0

/** A turn started from the editor's page, as far as the model being asked — which doesn't answer. */
async function turnUnderWay() {
  const runId = `run_${++n}`
  void startAgentRun({ runId, conversationId: `conv_${n}`, prompt: 'Tighten the intro', target: { kind: 'model', provider: 'anthropic', model: 'claude-opus-5-5' } })
  // It asks the editor for its tools first, and the page answers.
  expect(await until(() => win.webContents.calls.length === 1)).toBe(true)
  env.ipc.emit(IPC.bridgeResponse, { senderFrame: { url: 'app://lumen' } }, { id: win.webContents.calls[0].id, ok: true, result: [{ name: 'get_project', description: 'The project.', inputSchema: { type: 'object', properties: {} } }] })
  expect(await until(() => env.asked === 1)).toBe(true)
  return runId
}

beforeEach(() => {
  Object.assign(env, { asked: 0, ended: 0, stoppedLocal: 0 })
  win = new Window()
  initEditorRpc(win as never, (url) => url === 'app://lumen')
})

describe('a reply being written when the editor’s page goes away', () => {
  it('ends when the page is reloaded', async () => {
    const runId = await turnUnderWay()
    // Moving within the page, or a frame inside it loading, ends nothing.
    win.webContents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true })
    win.webContents.emit('did-start-navigation', { isMainFrame: false, isSameDocument: false })
    expect(await until(() => env.ended > 0, 50)).toBe(false)
    win.webContents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false })
    // The request to the model is given up, and the agents started for a reply are stopped with it.
    expect(await until(() => env.ended === 1, 500)).toBe(true)
    expect(env.stoppedLocal).toBe(1)
    expect(await until(() => win.webContents.told.some((e) => e.runId === runId && e.type === 'error' && e.code === 'cancelled'), 500)).toBe(true)
  })

  it('ends when the page’s process dies', async () => {
    await turnUnderWay()
    win.webContents.emit('render-process-gone', {}, { reason: 'crashed' })
    expect(await until(() => env.ended === 1, 500)).toBe(true)
  })

  it('ends when the window is closed', async () => {
    await turnUnderWay()
    win.destroyed = true
    win.emit('closed')
    expect(await until(() => env.ended === 1, 500)).toBe(true)
  })
})
