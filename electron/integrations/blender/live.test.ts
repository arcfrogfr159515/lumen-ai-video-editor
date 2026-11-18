import type { AddressInfo, Server, Socket } from 'node:net'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

// A stand-in for the Blender add-on: a real socket on this machine, at a port of its own (9876 may be a real Blender).
const env = vi.hoisted(() => ({ port: 0, heard: [] as string[], answer: (_socket: Socket) => {} }))

vi.mock('electron', () => ({ app: { getPath: (name: string) => `nowhere/${name}` }, BrowserWindow: class {} }))
vi.mock('node:net', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:net')>()
  const connect = (options: { host: string; port: number }) => actual.connect({ ...options, port: env.port })
  return { ...actual, default: { ...actual, connect }, connect }
})

const net = await vi.importActual<typeof import('node:net')>('node:net')
const { runLive } = await import('./index')

let server: Server
beforeAll(async () => {
  server = net.createServer((socket) => {
    socket.on('error', () => {})
    socket.once('data', (chunk) => {
      env.heard.push(chunk.toString('utf8'))
      env.answer(socket)
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  env.port = (server.address() as AddressInfo).port
})
afterAll(() => void server.close())

/** What the tool is told — or that it is still waiting, well after the 0.4 s it gives Blender here (a minute in use). */
const told = (code: string) => Promise.race([runLive(code, 400), new Promise<string>((resolve) => setTimeout(() => resolve('still waiting'), 1500))])

describe('code sent to the Blender the user has open', () => {
  it('comes back with what Blender answered, however the answer is cut up on the way', async () => {
    env.answer = (socket) => {
      socket.write('{"status":"success","res')
      setTimeout(() => socket.write('ult":{"objects":3}}'), 20)
    }
    expect(await told('len(bpy.data.objects)')).toEqual({ ok: true, result: { objects: 3 } })
    expect(JSON.parse(env.heard.at(-1)!)).toEqual({ type: 'execute_code', params: { code: 'len(bpy.data.objects)' } })
  })

  it('comes back with what Blender said went wrong', async () => {
    env.answer = (socket) => socket.write('{"status":"error","message":"name \'bpyy\' is not defined"}')
    expect(await told('bpyy')).toEqual({ ok: false, error: "name 'bpyy' is not defined" })
  })

  it('fails, rather than waiting for good, when Blender goes away before it answers', async () => {
    // Blender was closed while the code ran, or the code brought it down: the connection ends with nothing said.
    env.answer = (socket) => socket.end()
    expect(await told('bpy.ops.wm.quit_blender()')).toEqual({ ok: false, error: 'Blender closed the connection before it answered.' })
  })

  it('fails as well when Blender goes away half-way through its answer', async () => {
    env.answer = (socket) => socket.end('{"status":"success","res')
    expect(await told('bpy.ops.wm.quit_blender()')).toEqual({ ok: false, error: 'Blender closed the connection before it answered.' })
  })

  it('still gives up on a Blender that stays there and says nothing', async () => {
    env.answer = () => {}
    expect(await told('while True: pass')).toEqual({ ok: false, error: 'Blender didn’t answer in time.' })
  })
})
