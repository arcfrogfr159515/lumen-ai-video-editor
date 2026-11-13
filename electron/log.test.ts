import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => os.tmpdir(), getVersion: () => '1.0.0', isPackaged: false, isReady: () => true, getLocale: () => 'en', on: () => {} }, dialog: {}, shell: {} }))

const { openLog } = await import('./log')

let dir: string
let clock: number
const now = () => clock
const read = (name = 'lumen.log') => fs.readFileSync(path.join(dir, name), 'utf8')
const lines = (name?: string) => read(name).trimEnd().split('\n')

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-log-'))
  clock = Date.UTC(2026, 10, 13, 9, 30, 0)
})

afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

describe('the log', () => {
  it('writes when, how bad, from where and what — in a folder it makes itself', () => {
    const log = openLog({ dir: path.join(dir, 'logs'), now })
    log.write('warn', 'main', 'Couldn’t store a version', { code: 'ENOSPC' })
    expect(fs.readFileSync(log.file, 'utf8')).toBe("2026-11-13T09:30:00.000Z WARN  main: Couldn’t store a version { code: 'ENOSPC' }\n")
  })

  it('writes an error with where it was thrown', () => {
    const log = openLog({ dir, now })
    log.write('error', 'main', 'Nothing caught this exception:', new TypeError('x is not a function'))
    expect(read()).toMatch(/ERROR main: Nothing caught this exception: TypeError: x is not a function\n\s+at /)
  })

  it('adds to the file that is there', () => {
    openLog({ dir, now }).write('info', 'main', 'first run')
    openLog({ dir, now }).write('info', 'main', 'second run')
    expect(lines().map((l) => l.split(': ')[1])).toEqual(['first run', 'second run'])
  })

  it('writes a line said over and over once, and says how often', () => {
    const log = openLog({ dir, now })
    for (let i = 0; i < 500; i++) log.write('warn', 'editor', 'Filmstrip failed')
    log.write('warn', 'editor', 'Something else')
    expect(lines().map((l) => l.slice(25))).toEqual(['WARN  editor: Filmstrip failed', 'INFO  log: The line above was said 499 more times.', 'WARN  editor: Something else'])
  })

  it('holds only so many lines a minute, and says how many it left out', () => {
    const log = openLog({ dir, now, perMinute: 3 })
    for (let i = 0; i < 10; i++) log.write('warn', 'editor', `frame ${i}`)
    expect(lines()).toHaveLength(3)
    clock += 60_000
    log.write('warn', 'editor', 'a minute later')
    expect(lines().map((l) => l.slice(25))).toEqual(['WARN  editor: frame 0', 'WARN  editor: frame 1', 'WARN  editor: frame 2', 'WARN  log: 7 more lines were left out of that minute.', 'WARN  editor: a minute later'])
  })

  it('says what it was still counting when asked to finish', () => {
    const log = openLog({ dir, now })
    log.write('error', 'main', 'again')
    log.write('error', 'main', 'again')
    log.flush()
    expect(lines().map((l) => l.slice(25))).toEqual(['ERROR main: again', 'INFO  log: The line above was said 1 more time.'])
  })

  it('starts a new file past the limit, keeping the one before', () => {
    const log = openLog({ dir, now, limit: 100 })
    log.write('info', 'main', 'a'.repeat(150))
    log.write('info', 'main', 'b'.repeat(150))
    log.write('info', 'main', 'c'.repeat(150))
    expect(read()).toContain('c'.repeat(150))
    expect(read()).not.toContain('b'.repeat(150))
    expect(read('lumen.1.log')).toContain('b'.repeat(150))
    // Two files, never more: the first one's lines are gone.
    expect(fs.readdirSync(dir).sort()).toEqual(['lumen.1.log', 'lumen.log'])
    expect(read('lumen.1.log')).not.toContain('a'.repeat(150))
  })

  it('cuts a line that is far too long', () => {
    const log = openLog({ dir, now })
    log.write('error', 'editor', 'x'.repeat(50_000))
    expect(read().length).toBeLessThan(6100)
  })

  it('says nothing, and throws nothing, where it can’t write', () => {
    const blocked = path.join(dir, 'not-a-folder')
    fs.writeFileSync(blocked, '')
    const log = openLog({ dir: blocked, now })
    expect(() => {
      log.write('error', 'main', 'lost')
      log.flush()
    }).not.toThrow()
  })
})
