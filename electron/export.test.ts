import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const env = vi.hoisted(() => ({ root: '' }))
vi.mock('electron', () => ({ app: { getPath: (name: string) => `${env.root}/${name}` }, BrowserWindow: class {}, dialog: {} }))

env.root = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-export-test-'))
const { abortExport, beginFile, finishExport, writeExport, writeSidecar } = await import('./export')
const out = path.join(env.root, 'out')
const listed = () => fs.readdirSync(out).sort()
const errno = (code: string) => Object.assign(new Error(`${code}: resource busy or locked`), { code })
const same = (a: fs.PathLike, b: string) => path.resolve(String(a)) === path.resolve(b)

/** A render written in full, waiting for its name. */
async function rendered(target: string, content = 'the new render') {
  const handle = beginFile(target)
  await writeExport(handle.id, 0, new TextEncoder().encode(content))
  return handle
}

/** Another program has `file` open: it can be neither replaced nor removed, for `times` tries (or for good). */
function hold(file: string, times = Infinity) {
  const rename = fs.renameSync
  const rm = fs.rmSync
  let left = times
  vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
    if (same(to, file) && left-- > 0) throw errno('EBUSY')
    rename(from, to)
  })
  vi.spyOn(fs, 'rmSync').mockImplementation((target, opts) => {
    if (same(target, file) && left > 0) throw errno('EPERM')
    rm(target, opts)
  })
}

afterAll(() => fs.rmSync(env.root, { recursive: true, force: true }))
beforeEach(() => {
  fs.rmSync(out, { recursive: true, force: true })
  fs.mkdirSync(out, { recursive: true })
})
afterEach(() => vi.restoreAllMocks())

describe('finishing an export', () => {
  it('gives the file its name', async () => {
    const target = path.join(out, 'Film.mp4')
    const handle = await rendered(target)
    expect(listed()).toEqual(['Film.mp4.partial'])
    expect(finishExport(handle.id)).toEqual({ path: target, size: 14 })
    expect(listed()).toEqual(['Film.mp4'])
    expect(() => finishExport(handle.id)).toThrow(/no longer open/)
  })

  it('replaces the export before it in one step', async () => {
    const target = path.join(out, 'Film.mp4')
    fs.writeFileSync(target, 'the old render')
    const rm = vi.spyOn(fs, 'rmSync')
    const handle = await rendered(target)
    expect(finishExport(handle.id)).toEqual({ path: target, size: 14 })
    // The old file is never removed first: a failure after that would leave neither.
    expect(rm).not.toHaveBeenCalled()
    expect(fs.readFileSync(target, 'utf8')).toBe('the new render')
    expect(listed()).toEqual(['Film.mp4'])
  })

  it('replaces a read-only file', async () => {
    const target = path.join(out, 'Film.mp4')
    fs.writeFileSync(target, 'the old render')
    fs.chmodSync(target, 0o444)
    const handle = await rendered(target)
    expect(finishExport(handle.id)).toEqual({ path: target, size: 14 })
    expect(fs.readFileSync(target, 'utf8')).toBe('the new render')
    expect(listed()).toEqual(['Film.mp4'])
  })

  it('waits out a program that holds the old file for a moment', async () => {
    const target = path.join(out, 'Film.mp4')
    fs.writeFileSync(target, 'the old render')
    const handle = await rendered(target)
    hold(target, 3)
    expect(finishExport(handle.id)).toEqual({ path: target, size: 14 })
    expect(fs.readFileSync(target, 'utf8')).toBe('the new render')
    expect(listed()).toEqual(['Film.mp4'])
  })

  it('saves beside a file that stays open elsewhere, and says so', async () => {
    const target = path.join(out, 'Film.mp4')
    fs.writeFileSync(target, 'the old render')
    const handle = await rendered(target)
    // The last export is playing in a video player.
    hold(target)
    const done = finishExport(handle.id)
    const beside = path.join(out, 'Film 2.mp4')
    expect(done.path).toBe(beside)
    expect(done.size).toBe(14)
    expect(done.warnings).toEqual(['“Film.mp4” is open in another program and couldn’t be replaced. This was saved beside it as “Film 2.mp4”.'])
    expect(fs.readFileSync(beside, 'utf8')).toBe('the new render')
    expect(fs.readFileSync(target, 'utf8')).toBe('the old render')
    expect(listed()).toEqual(['Film 2.mp4', 'Film.mp4'])
    // Captions go next to the file that was written.
    vi.restoreAllMocks()
    expect(writeSidecar(done.path, 'srt', '1\n')).toBe(path.join(out, 'Film 2.srt'))
  })

  it('takes the next free name', async () => {
    const target = path.join(out, 'Film.mp4')
    for (const name of ['Film.mp4', 'Film 2.mp4', 'Film 3.mp4']) fs.writeFileSync(path.join(out, name), 'older')
    const handle = await rendered(target)
    hold(target)
    expect(finishExport(handle.id).path).toBe(path.join(out, 'Film 4.mp4'))
    expect(fs.readFileSync(path.join(out, 'Film 2.mp4'), 'utf8')).toBe('older')
  })

  it('keeps the finished file when it can’t be given any name', async () => {
    const target = path.join(out, 'Film.mp4')
    fs.writeFileSync(target, 'the old render')
    const handle = await rendered(target)
    vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      throw errno('ENOSPC')
    })
    expect(() => finishExport(handle.id)).toThrow(/complete, but it couldn’t be saved as “Film\.mp4”.*kept as “.*Film\.mp4\.partial”/)
    vi.restoreAllMocks()
    // The editor aborts an export that failed — which must not delete an hour of rendering.
    abortExport(handle.id)
    expect(fs.readFileSync(`${target}.partial`, 'utf8')).toBe('the new render')
    expect(fs.readFileSync(target, 'utf8')).toBe('the old render')
  })

  it('still deletes what an abandoned export wrote', async () => {
    const target = path.join(out, 'Film.mp4')
    const handle = await rendered(target)
    abortExport(handle.id)
    expect(listed()).toEqual([])
  })
})
