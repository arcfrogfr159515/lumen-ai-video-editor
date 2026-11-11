import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The window is a stand-in, and the "Save changes?" prompt answers what the test tells it to.
const env = vi.hoisted(() => ({ root: '', answer: 2, asked: [] as string[] }))
vi.mock('electron', () => ({
  app: { getPath: (name: string) => path.join(env.root, name), getVersion: () => '1.0.0', addRecentDocument: () => {} },
  dialog: {
    showMessageBox: async (_win: unknown, opts: { message: string }) => {
      env.asked.push(opts.message)
      return { response: env.answer }
    },
  },
  BrowserWindow: class {},
  net: {},
  protocol: {},
  shell: {},
}))

env.root = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-close-test-'))
const { closeNow, guardClose, saveProject, setProjectState } = await import('./project')
const { listVersions } = await import('./versions')

class Window extends EventEmitter {
  closed = false
  sent: string[] = []
  webContents = { send: (channel: string) => void this.sent.push(channel) }
  isDestroyed = () => this.closed
  setTitle() {}
  setDocumentEdited() {}
  setRepresentedFilename() {}
  /** What the OS does when the window is asked to close: the app may say no. */
  close() {
    let prevented = false
    this.emit('close', { preventDefault: () => void (prevented = true) })
    if (!prevented) this.closed = true
    return !prevented
  }
}
const open = () => {
  const win = new Window()
  guardClose(win as never)
  return win
}
const tick = () => new Promise((r) => setTimeout(r, 5))
const SAVE = 0
const DISCARD = 1
const CANCEL = 2

afterAll(() => fs.rmSync(env.root, { recursive: true, force: true }))
beforeEach(() => {
  env.asked.length = 0
  env.answer = CANCEL
})
afterEach(() => vi.restoreAllMocks())

describe('closing a window', () => {
  it('just closes when nothing is unsaved', () => {
    const win = open()
    setProjectState(win as never, { name: 'Film', dirty: false })
    expect(win.close()).toBe(true)
    expect(env.asked).toEqual([])
  })

  it('asks first when there are unsaved changes, and stays open on Cancel', async () => {
    const win = open()
    setProjectState(win as never, { name: 'Film', dirty: true })
    expect(win.close()).toBe(false)
    await tick()
    expect(env.asked).toEqual(['Save changes to “Film”?'])
    expect(win.closed).toBe(false)
  })

  it('closes on “Don’t save”, and asks the editor to save on “Save”', async () => {
    const win = open()
    setProjectState(win as never, { name: 'Film', dirty: true })
    env.answer = SAVE
    win.close()
    await tick()
    expect(win.sent).toHaveLength(1)
    expect(win.closed).toBe(false)
    env.answer = DISCARD
    win.close()
    await tick()
    expect(win.closed).toBe(true)
  })

  it('still asks in the next window, after one was closed without saving', async () => {
    // macOS: the app outlives its window, and a click on the dock icon opens another.
    const first = open()
    setProjectState(first as never, { name: 'Film', dirty: true })
    env.answer = DISCARD
    first.close()
    await tick()
    expect(first.closed).toBe(true)

    const second = open()
    // It starts clean, whatever the first was closed with.
    expect(second.close()).toBe(true)
    const third = open()
    setProjectState(third as never, { name: 'Next film', dirty: true })
    env.answer = CANCEL
    env.asked.length = 0
    expect(third.close()).toBe(false)
    await tick()
    expect(env.asked).toEqual(['Save changes to “Next film”?'])
    expect(third.closed).toBe(false)
  })

  it('closes a window that was told to, and only that one', () => {
    const one = open()
    const two = open()
    setProjectState(two as never, { name: 'Film', dirty: true })
    closeNow(one as never)
    expect(one.closed).toBe(true)
    expect(two.close()).toBe(false)
  })
})

describe('a project and its versions on disk', () => {
  const project = (name: string, clips = 0) =>
    JSON.stringify({ id: 'p-whole', name, settings: { width: 1920, height: 1080, fps: 30 }, tracks: [], markers: [], assets: {}, clips: Object.fromEntries(Array.from({ length: clips }, (_, i) => [`c${i}`, { id: `c${i}`, start: i * 30, duration: 30 }])) })
  const file = path.join(env.root, 'films', 'Film.lumen')
  const versions = path.join(env.root, 'userData', 'versions', 'p-whole')
  const names = () => listVersions('p-whole').map((v) => `${v.name}:${v.clips}`)

  it('keep the old file whole when a save breaks part-way', () => {
    saveProject(file, project('One', 1))
    const before = fs.readFileSync(file, 'utf8')
    const real = fs.writeFileSync
    vi.spyOn(fs, 'writeFileSync').mockImplementationOnce((fd, data) => {
      real(fd, String(data).slice(0, 20))
      throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' })
    })
    expect(() => saveProject(file, project('Two', 2))).toThrow(/ENOSPC/)
    vi.restoreAllMocks()
    expect(fs.readFileSync(file, 'utf8')).toBe(before)
    expect(fs.readdirSync(path.dirname(file))).toEqual(['Film.lumen'])
  })

  it('list a version that was written but never listed', async () => {
    await tick()
    saveProject(file, project('Two', 2))
    expect(names()).toEqual(['Two:2', 'One:1'])
    // Lumen stopped between writing a version and listing it.
    const stray = `${Date.now() + 50}-auto.lumen`
    fs.writeFileSync(path.join(versions, stray), JSON.stringify({ format: 'lumen-project', version: 1, project: JSON.parse(project('Stray', 5)) }))
    expect(names()).toEqual(['Stray:5', 'Two:2', 'One:1'])
    expect(listVersions('p-whole')[0]).toMatchObject({ id: stray, kind: 'auto', seconds: 5 })
  })

  it('find the versions again when the list itself is lost, and ignore half a file', async () => {
    fs.writeFileSync(path.join(versions, 'index.json'), '[{"id":"17')
    fs.writeFileSync(path.join(versions, `${Date.now() + 100}-save.lumen`), '{"format":"lumen-project","version":1,"project":{"name":"Hal')
    fs.writeFileSync(path.join(versions, 'notes.txt'), 'not a version')
    expect(names()).toEqual(['Stray:5', 'Two:2', 'One:1'])
    // The next save writes a list that can be read again, with everything in it.
    await tick()
    await new Promise((r) => setTimeout(r, 120))
    saveProject(file, project('Three', 3))
    expect(names()).toEqual(['Three:3', 'Stray:5', 'Two:2', 'One:1'])
    const index = JSON.parse(fs.readFileSync(path.join(versions, 'index.json'), 'utf8')) as { name: string }[]
    expect(index.map((v) => v.name)).toEqual(['Three', 'Stray', 'Two', 'One'])
  })
})
