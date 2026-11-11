import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

// Blender is a stand-in process the test drives, and the render window a stand-in that draws blank frames.
interface FakeChild extends EventEmitter {
  stdout: PassThrough
  stderr: PassThrough
  kill: () => void
}
const env = vi.hoisted(() => ({
  root: '',
  child: null as unknown as FakeChild,
  spawnFails: null as Error | null,
  page: { loads: true, frames: 3, destroyAt: -1, drawn: 0 },
  cancelAt: -1,
  cancel: (_id: string) => {},
  jobId: '',
}))

vi.mock('electron', () => ({
  app: { getPath: (name: string) => path.join(env.root, name), once: () => {} },
  session: { fromPartition: () => ({ webRequest: { onBeforeRequest: () => {} }, setPermissionRequestHandler: () => {} }) },
  BrowserWindow: class {},
  screen: {},
}))
vi.mock('node:child_process', async () => {
  const { EventEmitter } = await import('node:events')
  const { PassThrough } = await import('node:stream')
  return {
    execFile: (_file: string, _args: string[], _opts: unknown, cb: (err: Error | null, stdout: string) => void) => cb(null, 'Blender 4.2.0\n'),
    spawn: () => {
      if (env.spawnFails) throw env.spawnFails
      const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: () => {} }) as FakeChild
      env.child = child
      return child
    },
  }
})
vi.mock('node:net', async () => {
  const { EventEmitter } = await import('node:events')
  // Nothing listens where a live Blender would.
  const connect = () => {
    const socket = Object.assign(new EventEmitter(), { destroy: () => {}, setTimeout: () => {} })
    queueMicrotask(() => socket.emit('error', new Error('ECONNREFUSED')))
    return socket
  }
  return { default: { connect, isIP: () => 0 }, connect, isIP: () => 0 }
})
vi.mock('../offscreen', () => ({
  exactOffscreenWindow: () => {
    let destroyed = false
    const image = { getSize: () => ({ width: 320, height: 180 }), toPNG: () => Buffer.from('png'), resize: () => image }
    const win = {
      isDestroyed: () => destroyed,
      destroy: () => void (destroyed = true),
      loadFile: async () => {
        if (!env.page.loads) throw new Error('ERR_FILE_NOT_FOUND')
      },
      webContents: {
        setWindowOpenHandler: () => {},
        on: () => {},
        setFrameRate: () => {},
        executeJavaScript: async (code: string) => {
          if (destroyed) throw new Error('Object has been destroyed')
          return code.includes('getDuration') ? env.page.frames / 30 : true
        },
        capturePage: async () => {
          if (env.page.drawn === env.cancelAt) env.cancel(env.jobId)
          if (env.page.drawn === env.page.destroyAt) destroyed = true
          if (destroyed) throw new Error('Object has been destroyed')
          env.page.drawn++
          return image
        },
      },
    }
    return { win, resize: () => {} }
  },
}))

env.root = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-jobs-test-'))
const dummy = path.join(env.root, process.platform === 'win32' ? 'blender.exe' : 'blender')
fs.writeFileSync(dummy, '')
process.env.LUMEN_BLENDER = dummy
const { cancelJob, createJob, failJob, finishJob, getJob, isCancelled, updateJob } = await import('./jobs')
const { renderBlender } = await import('./blender')
const { renderMotion } = await import('./hyperframes')
env.cancel = cancelJob

const media = (kind: string, id: string) => path.join(env.root, 'userData', 'media', kind, id)
const scratch = (kind: string, id: string) => path.join(env.root, 'temp', 'lumen', kind, id)
const settled = async (id: string) => {
  for (let i = 0; i < 300 && getJob(id)?.status === 'running'; i++) await new Promise((r) => setTimeout(r, 5))
  await new Promise((r) => setTimeout(r, 20))
  return getJob(id)!
}

afterAll(() => {
  delete process.env.LUMEN_BLENDER
  fs.rmSync(env.root, { recursive: true, force: true })
})
beforeEach(() => {
  env.spawnFails = null
  env.page = { loads: true, frames: 3, destroyAt: -1, drawn: 0 }
  env.cancelAt = -1
})

describe('a job that has ended', () => {
  it('stays cancelled when the work it stopped goes on to fail', () => {
    const job = createJob('hyperframes', 'Title')
    cancelJob(job.id)
    // The window it drew in was destroyed: its last frame fails.
    failJob(job.id, new Error('Object has been destroyed'))
    finishJob(job.id, { message: '12 frames' })
    updateJob(job.id, { progress: 0.5 })
    expect(getJob(job.id)).toMatchObject({ status: 'cancelled' })
    expect(getJob(job.id)!.error).toBeUndefined()
    expect(isCancelled(job.id)).toBe(true)
  })

  it('keeps the first reason it failed for, and a finished job stays finished', () => {
    const broken = createJob('blender', 'Scene')
    failJob(broken.id, new Error('spawn blender.exe ENOENT'))
    failJob(broken.id, 'Blender exited with code -4058')
    expect(getJob(broken.id)).toMatchObject({ status: 'error', error: 'spawn blender.exe ENOENT' })
    const done = createJob('ai', 'Image')
    finishJob(done.id, { message: 'Done' })
    failJob(done.id, new Error('late'))
    cancelJob(done.id)
    expect(getJob(done.id)).toMatchObject({ status: 'done', message: 'Done', progress: 1 })
  })
})

describe('a Blender render', () => {
  const request = { template: 'title3d' as const, params: { text: 'Hello' }, width: 320, height: 180, fps: 30, duration: 1 }
  const frame = (id: string, n: number) => fs.writeFileSync(path.join(media('blender', id), `frame_${String(n).padStart(4, '0')}.png`), 'png')

  it('keeps its frames and clears its scratch folder when it comes through', async () => {
    const job = await renderBlender(request)
    expect(fs.existsSync(path.join(scratch('blender', job.id), 'spec.json'))).toBe(true)
    frame(job.id, 1)
    frame(job.id, 2)
    env.child.emit('close', 0)
    expect(getJob(job.id)).toMatchObject({ status: 'done', message: '2 frames' })
    expect(fs.readdirSync(media('blender', job.id))).toEqual(['frame_0001.png', 'frame_0002.png'])
    expect(fs.existsSync(scratch('blender', job.id))).toBe(false)
  })

  it('leaves nothing behind when it fails part-way', async () => {
    const job = await renderBlender(request)
    frame(job.id, 1)
    env.child.stdout.write('LUMEN {"type":"error","message":"Out of GPU memory"}\n')
    await new Promise((r) => setTimeout(r, 20))
    env.child.emit('close', 1)
    expect(getJob(job.id)).toMatchObject({ status: 'error', error: 'Out of GPU memory' })
    expect(fs.existsSync(media('blender', job.id))).toBe(false)
    expect(fs.existsSync(scratch('blender', job.id))).toBe(false)
  })

  it('leaves nothing behind when it is cancelled, and stays cancelled', async () => {
    const job = await renderBlender(request)
    frame(job.id, 1)
    cancelJob(job.id)
    env.child.emit('close', null)
    expect(getJob(job.id)).toMatchObject({ status: 'cancelled' })
    expect(fs.existsSync(media('blender', job.id))).toBe(false)
    expect(fs.existsSync(scratch('blender', job.id))).toBe(false)
  })

  it('fails with why Blender couldn’t be started', async () => {
    const job = await renderBlender(request)
    env.child.emit('error', new Error('spawn blender.exe EACCES'))
    env.child.emit('close', -4092)
    expect(getJob(job.id)).toMatchObject({ status: 'error', error: 'spawn blender.exe EACCES' })
    expect(fs.existsSync(media('blender', job.id))).toBe(false)
    expect(fs.existsSync(scratch('blender', job.id))).toBe(false)
  })

  it('doesn’t stay “running” when it can’t even be set up', async () => {
    env.spawnFails = new Error('spawn EINVAL')
    const before = new Set(fs.existsSync(path.join(env.root, 'userData', 'media', 'blender')) ? fs.readdirSync(path.join(env.root, 'userData', 'media', 'blender')) : [])
    await expect(renderBlender(request)).rejects.toThrow('spawn EINVAL')
    const after = fs.existsSync(path.join(env.root, 'userData', 'media', 'blender')) ? fs.readdirSync(path.join(env.root, 'userData', 'media', 'blender')) : []
    expect(after.filter((d) => !before.has(d))).toEqual([])
  })
})

describe('a motion render', () => {
  const request = { template: 'lower-third' as const, params: { title: 'Hello' }, width: 320, height: 180, fps: 30, duration: 0.1 }

  it('keeps its frames and clears its scratch folder when it comes through', async () => {
    const job = await settled((await renderMotion(request)).id)
    expect(job).toMatchObject({ status: 'done', message: '3 frames' })
    expect(fs.readdirSync(media('hyperframes', job.id))).toEqual(['frame_0001.png', 'frame_0002.png', 'frame_0003.png'])
    expect(fs.existsSync(scratch('hyperframes', job.id))).toBe(false)
  })

  it('leaves nothing behind when the composition can’t be loaded', async () => {
    env.page.loads = false
    const job = await settled((await renderMotion(request)).id)
    expect(job).toMatchObject({ status: 'error', error: 'ERR_FILE_NOT_FOUND' })
    expect(fs.existsSync(media('hyperframes', job.id))).toBe(false)
    expect(fs.existsSync(scratch('hyperframes', job.id))).toBe(false)
  })

  it('leaves nothing behind when it has nothing to render', async () => {
    const job = await settled((await renderMotion({ ...request, template: 'custom', params: {} })).id)
    expect(job).toMatchObject({ status: 'error', error: 'A custom motion graphic needs its HyperFrames HTML.' })
    expect(fs.existsSync(media('hyperframes', job.id))).toBe(false)
    expect(fs.existsSync(scratch('hyperframes', job.id))).toBe(false)
  })

  it('fails, rather than waiting for good, when its window dies part-way', async () => {
    env.page.destroyAt = 1
    const job = await settled((await renderMotion(request)).id)
    expect(job.status).toBe('error')
    expect(fs.existsSync(media('hyperframes', job.id))).toBe(false)
  })

  it('is cancelled, not failed, when it is stopped part-way — and leaves nothing behind', async () => {
    env.cancelAt = 1
    const started = await renderMotion({ ...request, duration: 0.2 })
    env.jobId = started.id
    const job = await settled(started.id)
    // Stopping destroys the window, and the frame being drawn fails with it: that isn't what the user is told.
    expect(job.status).toBe('cancelled')
    expect(job.error).toBeUndefined()
    expect(fs.existsSync(media('hyperframes', job.id))).toBe(false)
    expect(fs.existsSync(scratch('hyperframes', job.id))).toBe(false)
  })
})
