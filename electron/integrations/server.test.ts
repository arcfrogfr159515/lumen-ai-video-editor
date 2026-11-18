import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const env = vi.hoisted(() => ({ root: '' }))

vi.mock('electron', () => ({
  app: { getPath: (name: string) => path.join(env.root, name), getVersion: () => '9.9.9' },
  BrowserWindow: class {},
}))
// The editor window is a stand-in: nothing here calls a tool.
vi.mock('./editor-rpc', () => ({ askEditor: async () => ({ ok: false, error: 'no editor' }), editorInstructions: async () => '', editorTools: async () => [], editorWindow: () => null, initEditorRpc: () => {} }))

env.root = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-bridge-test-'))
const { readJson, writeJson } = await import('./paths')
const bridge = await import('./server')

/** A port nothing is listening on: the usual one may be taken by a Lumen that is running on this computer. */
const freePort = () =>
  new Promise<number>((resolve) => {
    const probe = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as net.AddressInfo
      probe.close(() => resolve(port))
    })
  })

/** Whether anything is listening on a port of this computer. */
const listening = (port: number) =>
  new Promise<boolean>((resolve) => {
    const socket = net.connect(port, '127.0.0.1')
    socket.once('connect', () => resolve((socket.destroy(), true))).once('error', () => resolve(false))
  })

let port = 0

beforeEach(async () => {
  await bridge.stopBridge(false)
  port = await freePort()
  writeJson('lumen-mcp.json', { port, token: 'secret', enabled: false })
})

afterAll(async () => {
  await bridge.stopBridge(false)
  fs.rmSync(env.root, { recursive: true, force: true })
})

describe('switching Lumen’s MCP server on and off', () => {
  it('starts once when it is started twice at once, and says nothing is wrong when it is off again', async () => {
    // The second start found nothing listening yet and tried the port for itself — which the first had just taken.
    // What it said then (“Port … is already in use.”) was kept, and shown as soon as the server was switched off.
    const [first, second] = await Promise.all([bridge.startBridge(), bridge.startBridge()])
    expect(first.status).toMatchObject({ running: true, port })
    expect(second.status).toMatchObject({ running: true, port })
    expect(await listening(port)).toBe(true)

    const off = await bridge.stopBridge(false)
    expect(off.status).toEqual({ running: false, port, error: undefined })
    expect(await listening(port)).toBe(false)
  })

  it('stays the user’s when an agent asks for its address in the moment the user switches it on', async () => {
    // The agent's side saw the switch still off, and so took the server the user had just started for one of its
    // own: off as far as the Integrations window could tell, with “port already in use” under it.
    const [, endpoint] = await Promise.all([bridge.startBridge(), bridge.bridgeEndpoint()])
    expect(endpoint).toEqual({ url: `http://127.0.0.1:${port}/mcp`, token: 'secret' })
    expect(bridge.bridgeState().status).toEqual({ running: true, port, url: `http://127.0.0.1:${port}/mcp`, token: 'secret' })
    expect(readJson<{ enabled?: boolean }>('lumen-mcp.json', {}).enabled).toBe(true)
  })

  it('is still only for the session when an agent alone asked for it', async () => {
    const endpoint = await bridge.bridgeEndpoint()
    expect(endpoint.url).toBe(`http://127.0.0.1:${port}/mcp`)
    expect(await listening(port)).toBe(true)
    // Listening for the agent, but not switched on: the user's switch is theirs.
    expect(bridge.bridgeState().status.running).toBe(false)
    expect(readJson<{ enabled?: boolean }>('lumen-mcp.json', {}).enabled).toBe(false)
  })

  it('is off when it is switched off while it is still starting', async () => {
    const starting = bridge.startBridge()
    await bridge.stopBridge(false)
    await starting
    // Switched off before it was listening, it found nothing to close — and the start then went through.
    expect(bridge.bridgeState().status.running).toBe(false)
    expect(await listening(port)).toBe(false)
  })
})
