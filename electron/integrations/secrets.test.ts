import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The keychain is a stand-in: it can be there or not, and what it encrypts only it can read back.
const env = vi.hoisted(() => ({ root: '', keychain: true as boolean, account: 'me', told: [] as { message: string; detail: string }[], crashed: 0 }))
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
    // Like the real one, it knows when what it is given back isn't all of what it wrote.
    encryptString: (text: string) => Buffer.from(`v10:${env.account}:${Buffer.from(text, 'utf8').toString('base64')}:end`),
    decryptString: (buf: Buffer) => {
      // The real one, given under fifteen bytes that begin with its version tag, doesn't throw: it ends the process
      // (seen in Electron 44 on Windows: 'out_of_range was thrown in -fno-exceptions mode'). Nothing may get that far.
      if (buf.length < 15 && buf.subarray(0, 3).toString('latin1') === 'v10') env.crashed++
      const [tag, account, body, end] = buf.toString('utf8').split(':')
      if (tag !== 'v10' || account !== env.account || !body || end !== 'end') throw new Error('Error while decrypting the ciphertext provided to safeStorage.decryptString.')
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
  env.crashed = 0
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
  // Whatever a test did to the file, the keychain was never handed something that takes the app down.
  expect(env.crashed).toBe(0)
})

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

  it('cut short at any length never take the app down, and are kept', async () => {
    let secrets = await launch()
    secrets.setSecret('ai.anthropic', 'sk-ant-123456')
    const saved = fs.readFileSync(file)
    // Every way a write can have stopped part-way — the short ones are what crashed Electron at every start.
    for (let length = 1; length < saved.length; length++) {
      fs.rmSync(`${file}.unreadable`, { force: true })
      fs.writeFileSync(file, saved.subarray(0, length))
      secrets = await launch()
      expect(secrets.getSecret('ai.anthropic'), `cut at ${length}`).toBeUndefined()
      expect(env.crashed, `cut at ${length}`).toBe(0)
      expect(fs.readFileSync(`${file}.unreadable`).length).toBe(length)
    }
    expect(() => secrets.decryptStored(Buffer.from('v10'))).toThrow(/too short/)
    expect(() => secrets.decryptStored(Buffer.alloc(0))).toThrow(/too short/)
    // Whole again, it reads.
    fs.writeFileSync(file, saved)
    secrets = await launch()
    expect(secrets.getSecret('ai.anthropic')).toBe('sk-ant-123456')
  })

  it('treat a file that isn’t a list of keys as unreadable', async () => {
    fs.writeFileSync(file, '[1,2,3]')
    const secrets = await launch()
    expect(secrets.getSecret('0')).toBeUndefined()
    expect(listed()).toEqual(['secrets.bin', 'secrets.bin.unreadable'])
  })
})

describe('before a secret is saved', () => {
  const localState = path.join(user, 'Local State')
  const withKey = JSON.stringify({ os_crypt: { audit_enabled: true, encrypted_key: 'RFBBUEkBAAAA0Iyd3wEV0RGMegDAT8KX6wEAAAA=' } })

  it('nothing is waited for where the key isn’t kept in a file of Chromium’s', async () => {
    const secrets = await launch()
    const t0 = Date.now()
    expect(await secrets.keychainSettled(5000, 'darwin')).toBe(true)
    expect(await secrets.keychainSettled(5000, 'linux')).toBe(true)
    env.keychain = false
    expect(await secrets.keychainSettled(5000, 'win32')).toBe(true)
    expect(Date.now() - t0).toBeLessThan(150)
  })

  it('on Windows, the key the keychain encrypts with is waited for until it is on disk', async () => {
    const secrets = await launch()
    let answered: boolean | null = null
    const waiting = secrets.keychainSettled(5000, 'win32').then((ok) => (answered = ok))
    await new Promise((r) => setTimeout(r, 450))
    expect(answered).toBeNull()
    // The file is there, but the key isn't in it yet.
    fs.writeFileSync(localState, JSON.stringify({ os_crypt: { audit_enabled: true } }))
    await new Promise((r) => setTimeout(r, 450))
    expect(answered).toBeNull()
    fs.writeFileSync(localState, withKey)
    await waiting
    expect(answered).toBe(true)
    // Once there it stays: it isn't looked for again.
    fs.rmSync(localState)
    const t0 = Date.now()
    expect(await secrets.keychainSettled(5000, 'win32')).toBe(true)
    expect(Date.now() - t0).toBeLessThan(100)
  })

  it('a profile that has been used before answers at once', async () => {
    fs.writeFileSync(localState, withKey)
    const secrets = await launch()
    const t0 = Date.now()
    expect(await secrets.keychainSettled(5000, 'win32')).toBe(true)
    expect(Date.now() - t0).toBeLessThan(100)
  })

  it('saving goes ahead as before if the key never comes', async () => {
    fs.writeFileSync(localState, '{ not json')
    const secrets = await launch()
    const t0 = Date.now()
    expect(await secrets.keychainSettled(600, 'win32')).toBe(false)
    expect(Date.now() - t0).toBeGreaterThanOrEqual(590)
    secrets.setSecret('ai.openai', 'sk-kept')
    expect((await launch()).getSecret('ai.openai')).toBe('sk-kept')
  })
})
