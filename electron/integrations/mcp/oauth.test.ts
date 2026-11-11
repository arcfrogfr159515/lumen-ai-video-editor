import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'

const env = vi.hoisted(() => ({ root: '' }))
vi.mock('electron', () => ({
  app: { getPath: (name: string) => `${env.root}/${name}` },
  shell: {},
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (text: string) => Buffer.from(`enc:${Buffer.from(text, 'utf8').toString('base64')}`),
    decryptString: (buf: Buffer) => {
      const text = buf.toString('utf8')
      if (!text.startsWith('enc:')) throw new Error('Error while decrypting the ciphertext provided to safeStorage.decryptString.')
      return Buffer.from(text.slice(4), 'base64').toString('utf8')
    },
  },
}))

env.root = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-oauth-test-')).replace(/\\/g, '/')
const { callbackPage, hasTokens, LumenOAuthProvider } = await import('./oauth')

afterAll(() => fs.rmSync(env.root, { recursive: true, force: true }))
afterEach(() => vi.restoreAllMocks())

describe('the page a sign-in comes back to', () => {
  it('shows what the service said as text, never as markup', () => {
    // error_description comes straight from the address the browser was sent back to.
    const page = callbackPage('Sign-in didn’t finish', '<script>fetch("http://127.0.0.1:47913/steal")</script><img src=x onerror="alert(1)">')
    expect(page).not.toMatch(/<script|<img|onerror="/)
    expect(page).toContain('&#60;script&#62;fetch(&#34;http://127.0.0.1:47913/steal&#34;)&#60;/script&#62;')
    // The page's own markup is still there.
    expect(page).toMatch(/<main><h1>Sign-in didn’t finish<\/h1><p>/)
  })

  it('escapes its title too, and keeps a long message short', () => {
    expect(callbackPage('a & <b>', 'ok')).toContain('<h1>a &#38; &#60;b&#62;</h1>')
    const page = callbackPage('Sign-in didn’t finish', 'x'.repeat(5000))
    expect(page.length).toBeLessThan(1600)
  })

  it('says the plain things plainly', () => {
    expect(callbackPage('Connected to Lumen', 'You can close this tab and head back to your edit.')).toContain('<p>You can close this tab and head back to your edit.</p>')
  })
})

describe('a sign-in kept on disk', () => {
  const stored = () => path.join(env.root, 'userData', 'mcp-auth')

  it('is encrypted, read back, and written whole', () => {
    const auth = new LumenOAuthProvider('figma')
    expect(hasTokens('figma')).toBe(false)
    auth.saveTokens({ access_token: 'at-123', token_type: 'Bearer', refresh_token: 'rt-456' })
    auth.saveCodeVerifier('verifier-1')
    expect(auth.tokens()).toMatchObject({ access_token: 'at-123', refresh_token: 'rt-456' })
    expect(auth.codeVerifier()).toBe('verifier-1')
    expect(fs.readFileSync(path.join(stored(), 'figma.bin'), 'utf8')).not.toContain('at-123')
    expect(fs.readdirSync(stored())).toEqual(['figma.bin'])
    // A write that breaks part-way leaves the sign-in as it was.
    vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' })
    })
    expect(() => auth.saveTokens({ access_token: 'at-new', token_type: 'Bearer' })).toThrow(/ENOSPC/)
    vi.restoreAllMocks()
    expect(auth.tokens()).toMatchObject({ access_token: 'at-123' })
    expect(fs.readdirSync(stored())).toEqual(['figma.bin'])
    auth.invalidateCredentials('all')
    expect(hasTokens('figma')).toBe(false)
  })
})
