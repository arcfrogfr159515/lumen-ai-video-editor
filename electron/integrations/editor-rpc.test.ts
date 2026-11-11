import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BridgeRequest } from '../../shared/integrations'

// The editor window is a stand-in: it keeps what it is sent, and answers when the test says so.
const env = vi.hoisted(() => ({ ipc: null as unknown as import('node:events').EventEmitter }))
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  env.ipc = new EventEmitter()
  return { ipcMain: env.ipc, BrowserWindow: class {} }
})

const { askEditor, callEditorTool, editorTools, editorWindow, initEditorRpc } = await import('./editor-rpc')
const { IPC } = await import('../../shared/integrations')

class Page extends EventEmitter {
  sent: BridgeRequest[] = []
  send(_channel: string, req: BridgeRequest) {
    this.sent.push(req)
  }
}
class Window extends EventEmitter {
  webContents = new Page()
  destroyed = false
  isDestroyed = () => this.destroyed
  close() {
    this.destroyed = true
    this.emit('closed')
  }
}

let win: Window
const open = () => {
  const w = new Window()
  initEditorRpc(w as never, (url) => url === 'app://lumen')
  return w
}
/** The editor's page answers the call it was sent. */
const answer = (res: { ok: boolean; result?: unknown; error?: string }, n = 0, from = 'app://lumen') => env.ipc.emit(IPC.bridgeResponse, { senderFrame: { url: from } }, { ...res, id: win.webContents.sent[n].id })
const pending = (p: Promise<unknown>) => Promise.race([p.then(() => false), new Promise((r) => setTimeout(() => r(true), 20))])

beforeEach(() => {
  win = open()
})

describe('calls into the editor', () => {
  it('come back with the editor’s answer', async () => {
    const call = callEditorTool('get_project', { detail: 'full' })
    expect(win.webContents.sent[0]).toMatchObject({ method: 'call', tool: 'get_project', args: { detail: 'full' } })
    answer({ ok: true, result: { content: [{ type: 'text', text: 'ok' }] } })
    expect(await call).toEqual({ content: [{ type: 'text', text: 'ok' }] })
  })

  it('ignore an answer that doesn’t come from the editor’s own page', async () => {
    const call = askEditor({ method: 'tools' }, 60_000)
    answer({ ok: true, result: [] }, 0, 'https://evil.example.com')
    expect(await pending(call)).toBe(true)
    answer({ ok: true, result: [{ name: 'get_project' }] })
    expect(await call).toMatchObject({ ok: true })
  })

  it('give up when the time is up', async () => {
    expect(await askEditor({ method: 'instructions' }, 20)).toMatchObject({ ok: false, error: 'Lumen didn’t answer in time.' })
  })

  it('fail at once when the editor is reloaded', async () => {
    // A tool that may run for twenty minutes, and an agent waiting on it.
    const call = callEditorTool('export_video', {}, 20 * 60_000)
    const list = editorTools()
    // Moving within the page, or a frame inside it loading, forgets nothing.
    win.webContents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true })
    win.webContents.emit('did-start-navigation', { isMainFrame: false, isSameDocument: false })
    expect(await pending(call)).toBe(true)
    win.webContents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false })
    expect(await call).toEqual({ content: [{ type: 'text', text: 'Lumen’s editor was reloaded before it answered.' }], isError: true })
    await expect(list).rejects.toThrow('reloaded before it answered')
    // What the old page answers afterwards (it can't) is nobody's.
    answer({ ok: true, result: 'late' })
    // The reloaded editor takes new calls.
    const again = askEditor({ method: 'tools' }, 60_000)
    answer({ ok: true, result: [] }, 2)
    expect(await again).toMatchObject({ ok: true })
  })

  it('fail at once when the editor is reloaded, as older Electron versions tell it', async () => {
    const call = askEditor({ method: 'tools' }, 60_000)
    win.webContents.emit('did-start-navigation', {}, 'app://lumen', false, true)
    expect(await call).toMatchObject({ ok: false, error: 'Lumen’s editor was reloaded before it answered.' })
  })

  it('fail at once when the editor’s process dies or its window closes', async () => {
    const crashed = askEditor({ method: 'tools' }, 60_000)
    win.webContents.emit('render-process-gone', {}, { reason: 'crashed' })
    expect(await crashed).toMatchObject({ ok: false, error: 'Lumen’s editor stopped working before it answered.' })
    const closed = askEditor({ method: 'tools' }, 60_000)
    win.close()
    expect(await closed).toMatchObject({ ok: false, error: 'Lumen’s editor window was closed before it answered.' })
    expect(editorWindow()).toBeNull()
    expect(await askEditor({ method: 'tools' }, 60_000)).toMatchObject({ ok: false, error: 'Lumen’s editor window isn’t open.' })
  })

  it('of a window that closes don’t take a newer window’s calls with them', async () => {
    const old = win
    win = open()
    const call = askEditor({ method: 'tools' }, 60_000)
    old.close()
    expect(await pending(call)).toBe(true)
    expect(editorWindow()).not.toBeNull()
    answer({ ok: true, result: [] })
    expect(await call).toMatchObject({ ok: true })
  })
})
