import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const env = vi.hoisted(() => ({ root: '' }))
vi.mock('electron', () => ({ app: { getPath: (name: string) => `${env.root}/${name}` } }))

env.root = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-paths-test-')).replace(/\\/g, '/')
const { keepUnreadable, readJson, userDir, writeFileAtomic, writeJson } = await import('./paths')
const user = userDir()
const listed = () => fs.readdirSync(user).sort()
const errno = (code: string) => Object.assign(new Error(`${code}: operation not permitted`), { code })

afterAll(() => fs.rmSync(env.root, { recursive: true, force: true }))
beforeEach(() => {
  fs.rmSync(user, { recursive: true, force: true })
  fs.mkdirSync(user, { recursive: true })
})
afterEach(() => vi.restoreAllMocks())

describe('writing a file whole', () => {
  it('writes it, replaces it, and leaves nothing else behind', () => {
    const file = path.join(user, 'settings.json')
    writeFileAtomic(file, 'one')
    expect(fs.readFileSync(file, 'utf8')).toBe('one')
    writeFileAtomic(file, Buffer.from('two'))
    expect(fs.readFileSync(file, 'utf8')).toBe('two')
    expect(listed()).toEqual(['settings.json'])
  })

  it('makes the folder it needs', () => {
    const file = path.join(user, 'deep', 'er', 'a.json')
    writeFileAtomic(file, '{}')
    expect(fs.readFileSync(file, 'utf8')).toBe('{}')
  })

  it('keeps the old file whole when the write breaks part-way', () => {
    const file = path.join(user, 'servers.json')
    writeFileAtomic(file, '{"servers":["a","b"]}')
    // The disk fills up after half of the new content.
    const real = fs.writeFileSync
    vi.spyOn(fs, 'writeFileSync').mockImplementationOnce((fd, data) => {
      real(fd, String(data).slice(0, 5))
      throw errno('ENOSPC')
    })
    expect(() => writeFileAtomic(file, '{"servers":["a","b","c"]}')).toThrow(/ENOSPC/)
    expect(fs.readFileSync(file, 'utf8')).toBe('{"servers":["a","b"]}')
    expect(listed()).toEqual(['servers.json'])
  })

  it('waits out a program holding the old file for a moment', () => {
    const file = path.join(user, 'settings.json')
    writeFileAtomic(file, 'old')
    const real = fs.renameSync
    let held = 2
    const rename = vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      if (held-- > 0) throw errno('EPERM')
      real(from, to)
    })
    writeFileAtomic(file, 'new')
    expect(rename).toHaveBeenCalledTimes(3)
    expect(fs.readFileSync(file, 'utf8')).toBe('new')
    expect(listed()).toEqual(['settings.json'])
  })

  it('gives up when the old file stays held, leaving it as it was', () => {
    const file = path.join(user, 'settings.json')
    writeFileAtomic(file, 'old')
    const rename = vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      throw errno('EBUSY')
    })
    expect(() => writeFileAtomic(file, 'new')).toThrow(/EBUSY/)
    expect(rename).toHaveBeenCalledTimes(5)
    expect(fs.readFileSync(file, 'utf8')).toBe('old')
    expect(listed()).toEqual(['settings.json'])
  })

  it('does not wait on a failure that waiting won’t cure', () => {
    const rename = vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      throw errno('ENOSPC')
    })
    expect(() => writeFileAtomic(path.join(user, 'a.json'), 'x')).toThrow(/ENOSPC/)
    expect(rename).toHaveBeenCalledTimes(1)
    expect(listed()).toEqual([])
  })
})

describe('settings files', () => {
  it('read back what was written', () => {
    writeJson('mcp-servers.json', [{ id: 'a' }])
    expect(readJson('mcp-servers.json', [])).toEqual([{ id: 'a' }])
    expect(listed()).toEqual(['mcp-servers.json'])
  })

  it('give the defaults when there is no file, and keep nothing', () => {
    expect(readJson('nothing.json', { enabled: false })).toEqual({ enabled: false })
    expect(listed()).toEqual([])
  })

  it('keep a damaged file beside the one written in its place', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    // What a power cut in the middle of a plain write leaves: the first half of the file.
    fs.writeFileSync(path.join(user, 'ai-providers.json'), '{"anthropic":{"model":"claude","baseUrl":"https://proxy.exa')
    expect(readJson('ai-providers.json', {})).toEqual({})
    expect(listed()).toEqual(['ai-providers.json', 'ai-providers.json.unreadable'])
    // Read again and again (settings are read on every request): one copy, one warning.
    expect(readJson('ai-providers.json', {})).toEqual({})
    expect(warn).toHaveBeenCalledTimes(1)
    // The next change is written over the damaged file — what it held is still there to look at.
    writeJson('ai-providers.json', { openai: { model: 'gpt' } })
    expect(readJson('ai-providers.json', {})).toEqual({ openai: { model: 'gpt' } })
    expect(fs.readFileSync(path.join(user, 'ai-providers.json.unreadable'), 'utf8')).toBe('{"anthropic":{"model":"claude","baseUrl":"https://proxy.exa')
  })

  it('treat an empty file as no file', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    fs.writeFileSync(path.join(user, 'blender.json'), '')
    expect(readJson('blender.json', { path: null })).toEqual({ path: null })
    expect(listed()).toEqual(['blender.json'])
  })

  it('say whether a damaged file was seen before', () => {
    const file = path.join(user, 'x.bin')
    fs.writeFileSync(file, 'garbage')
    expect(keepUnreadable(file)).toEqual({ path: `${file}.unreadable`, fresh: true })
    expect(keepUnreadable(file)).toEqual({ path: `${file}.unreadable`, fresh: false })
    fs.writeFileSync(file, 'other garbage')
    expect(keepUnreadable(file)?.fresh).toBe(true)
    expect(keepUnreadable(path.join(user, 'missing.bin'))).toBeNull()
  })
})
