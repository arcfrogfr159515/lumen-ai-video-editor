import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The keychain is a stand-in: it can be there or not, and what it encrypts only it can read back.
const env = vi.hoisted(() => ({ root: '', keychain: true as boolean, account: 'me', told: [] as { message: string; detail: string }[] }))
vi.mock('electron', () => ({
  app: { getPath: (name: string) => `${env.root}/${name}`, isReady: () => true, whenReady: async () => {} },
  dialog: {
    showMessageBox: async (opts: { message: string; detail: string }) => {
      env.told.push(opts)
      return { response: 0 }
    },
  },
  safeStorage: {
    isEncryptionAvailable: () => env.keychain,
    encryptString: (text: string) => Buffer.from(`v10:${env.account}:${Buffer.from(text, 'utf8').toString('base64')}`),
    decryptString: (buf: Buffer) => {
      const [tag, account, body] = buf.toString('utf8').split(':')
      if (tag !== 'v10' || account !== env.account || !body) throw new Error('Error while decrypting the ciphertext provided to safeStorage.decryptString.')
      return Buffer.from(body, 'base64').toString('utf8')
    },
  },
}))

env.root = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-secrets-test-')).replace(/\\/g, '/')
const user = path.join(env.root, 'userData')
const file = path.join(user, 'secrets.bin')
const listed = () => fs.readdirSync(user).sort()
/** The app started again: nothing is remembered but what is on disk. */
const launch = async () => {
  vi.resetModules()
  return await import('./secrets')
}

afterAll(() => fs.rmSync(env.root, { recursive: true, force: true }))
beforeEach(() => {
  fs.rmSync(user, { recursive: true, force: true })
  fs.mkdirSync(user, { recursive: true })
  env.keychain = true
  env.account = 'me'
  env.told.length = 0
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe('saved keys', () => {
  it('are kept encrypted and read again after a restart', async () => {
    let secrets = await launch()
    expect(secrets.getSecret('ai.anthropic')).toBeUndefined()
    secrets.setSecret('ai.anthropic', 'sk-ant-123456')
    secrets.setSecret('elevenlabs', 'el-key')
    expect(fs.readFileSync(file, 'utf8')).not.toContain('sk-ant-123456')
    expect(listed()).toEqual(['secrets.bin'])
    secrets = await launch()
    expect(secrets.getSecret('ai.anthropic')).toBe('sk-ant-123456')
    secrets.setSecret('elevenlabs', null)
    secrets = await launch()
    expect(secrets.getSecret('elevenlabs')).toBeUndefined()
    expect(secrets.getSecret('ai.anthropic')).toBe('sk-ant-123456')
    expect(secrets.secretHint('sk-ant-123456')).toBe('…3456')
    expect(env.told).toEqual([])
  })

  it('written while the keychain couldn’t be reached are still read once it can', async () => {
    env.keychain = false
    let secrets = await launch()
    secrets.setSecret('ai.openai', 'sk-plain')
    env.keychain = true
    secrets = await launch()
    expect(secrets.getSecret('ai.openai')).toBe('sk-plain')
    expect(env.told).toEqual([])
    expect(listed()).toEqual(['secrets.bin'])
  })

  it('survive a write that breaks part-way', async () => {
    let secrets = await launch()
    secrets.setSecret('ai.anthropic', 'sk-ant-123456')
    vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' })
    })
    expect(() => secrets.setSecret('ai.openai', 'sk-second')).toThrow(/ENOSPC/)
    vi.restoreAllMocks()
    secrets = await launch()
    expect(secrets.getSecret('ai.anthropic')).toBe('sk-ant-123456')
    expect(listed()).toEqual(['secrets.bin'])
  })

  it('that can’t be read are kept beside the new file, and the user is told once', async () => {
    let secrets = await launch()
    secrets.setSecret('ai.anthropic', 'sk-ant-123456')
    const saved = fs.readFileSync(file)
    // What a power cut in the middle of a plain write leaves: the first part of the file.
    fs.writeFileSync(file, saved.subarray(0, 9))
    secrets = await launch()
    expect(secrets.getSecret('ai.anthropic')).toBeUndefined()
    expect(listed()).toEqual(['secrets.bin', 'secrets.bin.unreadable'])
    expect(env.told).toHaveLength(1)
    expect(env.told[0].message).toMatch(/couldn’t be read/)
    expect(env.told[0].detail).toContain(`${file}.unreadable`)
    // The next launches find the same damaged file: the user was told already.
    secrets = await launch()
    expect(secrets.getSecret('ai.anthropic')).toBeUndefined()
    expect(env.told).toHaveLength(1)
    // A new key is saved over the damaged file; what was there is still beside it.
    secrets.setSecret('ai.openai', 'sk-new')
    secrets = await launch()
    expect(secrets.getSecret('ai.openai')).toBe('sk-new')
    expect(fs.readFileSync(`${file}.unreadable`).equals(saved.subarray(0, 9))).toBe(true)
    expect(env.told).toHaveLength(1)
  })

  it('come back by themselves when the keychain does', async () => {
    let secrets = await launch()
    secrets.setSecret('mcp.headers.figma', '{"Authorization":"Bearer abc"}')
    // A launch where the keychain can't be reached (no keyring daemon on Linux, say).
    env.keychain = false
    secrets = await launch()
    expect(secrets.getSecret('mcp.headers.figma')).toBeUndefined()
    expect(env.told).toHaveLength(1)
    env.keychain = true
    secrets = await launch()
    expect(secrets.getSecret('mcp.headers.figma')).toBe('{"Authorization":"Bearer abc"}')
  })

  it('saved under another account can’t be read, and are not thrown away', async () => {
    let secrets = await launch()
    secrets.setSecret('ai.anthropic', 'sk-ant-123456')
    const saved = fs.readFileSync(file)
    env.account = 'someone else'
    secrets = await launch()
    expect(secrets.getSecret('ai.anthropic')).toBeUndefined()
    secrets.setSecret('ai.anthropic', 'sk-theirs')
    expect(fs.readFileSync(`${file}.unreadable`).equals(saved)).toBe(true)
  })

  it('are not replaced by one key when the file is only busy', async () => {
    let secrets = await launch()
    secrets.setSecret('ai.anthropic', 'sk-ant-123456')
    secrets = await launch()
    // Another program holds the file at the moment it is first read.
    const read = vi.spyOn(fs, 'readFileSync').mockImplementation(() => {
      throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' })
    })
    expect(secrets.getSecret('ai.anthropic')).toBeUndefined()
    expect(() => secrets.setSecret('ai.openai', 'sk-second')).toThrow(/can’t be opened right now/)
    read.mockRestore()
    // Nothing was written over it, and the keys are found the next time they are asked for.
    expect(secrets.getSecret('ai.anthropic')).toBe('sk-ant-123456')
    secrets.setSecret('ai.openai', 'sk-second')
    secrets = await launch()
    expect(secrets.getSecret('ai.anthropic')).toBe('sk-ant-123456')
    expect(secrets.getSecret('ai.openai')).toBe('sk-second')
    expect(env.told).toEqual([])
  })

  it('treat a file that isn’t a list of keys as unreadable', async () => {
    fs.writeFileSync(file, '[1,2,3]')
    const secrets = await launch()
    expect(secrets.getSecret('0')).toBeUndefined()
    expect(listed()).toEqual(['secrets.bin', 'secrets.bin.unreadable'])
  })
})
