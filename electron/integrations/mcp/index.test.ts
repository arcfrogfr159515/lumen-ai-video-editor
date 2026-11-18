import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

// No servers here: a client is a stand-in that says what was done to it, and connecting — starting the server's
// program and greeting it — takes until the test says so.
const lab = vi.hoisted(() => ({
  root: '',
  made: [] as { command: string; closed: number }[],
  greeted: null as null | (() => void),
  ready: null as null | (() => void),
}))

vi.mock('electron', () => ({
  app: { getPath: (name: string) => `${lab.root}/${name}`, getVersion: () => '0.0.0' },
  BrowserWindow: { getAllWindows: () => [] },
}))
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: class {
    onclose: (() => void) | null = null
    private made: { command: string; closed: number } | null = null
    async connect(transport: { command: string }) {
      this.made = { command: transport.command, closed: 0 }
      lab.made.push(this.made)
      await new Promise<void>((resolve) => {
        lab.greeted = resolve
        lab.ready?.()
      })
    }
    getServerVersion = () => ({ name: 'stand-in', version: '1' })
    getServerCapabilities = () => ({ tools: {} })
    listTools = async () => ({ tools: [{ name: 'draw', description: 'Draws', inputSchema: { type: 'object' } }] })
    async close() {
      this.made!.closed++
      this.onclose?.()
    }
  },
}))
vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  getDefaultEnvironment: () => ({}),
  StdioClientTransport: class {
    command: string
    stderr = { on: () => {} }
    constructor(opts: { command: string }) {
      this.command = opts.command
    }
  },
}))
vi.mock('@modelcontextprotocol/sdk/client/auth.js', () => ({ UnauthorizedError: class extends Error {} }))
vi.mock('@modelcontextprotocol/sdk/client/sse.js', () => ({ SSEClientTransport: class {} }))
vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({ StreamableHTTPClientTransport: class {}, StreamableHTTPError: class extends Error {} }))
vi.mock('../secrets', () => ({ getSecret: () => null, setSecret: () => {}, keychainSettled: async () => {} }))
vi.mock('./oauth', () => ({ clearAuth: () => {}, hasTokens: () => false, LumenOAuthProvider: class {} }))

lab.root = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-mcp-')).replace(/\\/g, '/')
afterAll(() => fs.rmSync(lab.root, { recursive: true, force: true }))

const { connectServer, disconnectServer, listServers, removeServer, saveServer } = await import('./index')

/** Resolves when a connection being made has started its server and is waiting to be greeted. */
const greeting = () => new Promise<void>((resolve) => (lab.greeted ? resolve() : (lab.ready = resolve)))
function greet() {
  const go = lab.greeted!
  lab.greeted = null
  lab.ready = null
  go()
}
const statusOf = (id: string) => listServers().find((s) => s.config.id === id)?.status

let n = 0
let id = ''
beforeEach(async () => {
  while (lab.greeted) {
    greet()
    await new Promise((r) => setTimeout(r, 5))
  }
  lab.made.length = 0
  id = `server-${++n}`
  await saveServer({ id, name: 'Stand-in', enabled: true, transport: 'stdio', command: 'npx stand-in' })
})

describe('a server of tools', () => {
  it('connects, and lists what it can do', async () => {
    const connecting = connectServer(id)
    await greeting()
    expect(statusOf(id)).toBe('connecting')
    greet()
    expect(await connecting).toMatchObject({ status: 'connected', tools: [{ name: 'draw' }], server: { name: 'stand-in' } })
    expect(await disconnectServer(id)).toMatchObject({ status: 'disconnected', tools: [] })
    expect(lab.made).toEqual([{ command: 'npx stand-in', closed: 1 }])
  })

  it('stays disconnected when it is disconnected while it is connecting', async () => {
    // Starting a server's program takes a while, and until it had answered there was no connection to drop:
    // Disconnect did nothing that lasted — when the server answered it was connected all the same.
    const connecting = connectServer(id)
    await greeting()
    expect(await disconnectServer(id)).toMatchObject({ status: 'disconnected' })
    greet()
    expect(await connecting).toMatchObject({ status: 'disconnected', tools: [] })
    expect(statusOf(id)).toBe('disconnected')
    expect(lab.made).toEqual([{ command: 'npx stand-in', closed: 1 }])
  })

  it('leaves no program running when it is removed while it is connecting', async () => {
    // Removed in that moment, the server was gone from the list — and its program went on running, with nothing
    // left that could stop it.
    const connecting = connectServer(id)
    await greeting()
    await removeServer(id)
    expect(statusOf(id)).toBeUndefined()
    greet()
    await connecting
    expect(lab.made).toEqual([{ command: 'npx stand-in', closed: 1 }])
  })

  it('doesn’t keep a connection to the program it ran before, when what it runs is changed while it is connecting', async () => {
    const connecting = connectServer(id)
    await greeting()
    await saveServer({ id, name: 'Stand-in', enabled: true, transport: 'stdio', command: 'npx another' })
    greet()
    expect(await connecting).toMatchObject({ status: 'disconnected' })
    expect(lab.made).toEqual([{ command: 'npx stand-in', closed: 1 }])
  })
})
