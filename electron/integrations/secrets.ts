import fs from 'node:fs'
import path from 'node:path'
import { app, dialog, safeStorage } from 'electron'
import { keepUnreadable, userDir, writeFileAtomic } from './paths'

/**
 * API keys and other secrets, encrypted with the OS keychain (DPAPI on
 * Windows, Keychain on macOS, libsecret on Linux). They never leave the
 * main process; the editor only ever sees a hint like "…a1b2".
 */

const FILE = 'secrets.bin'
let cache: Record<string, string> | null = null

/**
 * The shortest thing the keychain can have written: a three-byte version tag,
 * then on Windows a nonce and an authentication tag (12 + 16 bytes), elsewhere
 * one cipher block (16).
 */
const SHORTEST = process.platform === 'win32' ? 31 : 19

/**
 * What the keychain encrypted, as text. Throws when it can't be decrypted.
 *
 * A file cut short must never reach the keychain: handed a few bytes that
 * begin with its version tag, Electron's safeStorage doesn't throw — it takes
 * the whole app down (a C++ out_of_range in a build without exceptions), and
 * since the file is read as Lumen starts, Lumen would never start again.
 */
export function decryptStored(buf: Buffer): string {
  if (buf.length < SHORTEST) throw new Error('The file is too short to be something the keychain wrote.')
  return safeStorage.decryptString(buf)
}

/** The secrets in the file, or null when it can't be made sense of. */
function decode(buf: Buffer): Record<string, string> | null {
  const parse = (text: string) => {
    const value = JSON.parse(text) as unknown
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, string>) : null
  }
  if (safeStorage.isEncryptionAvailable()) {
    try {
      return parse(decryptStored(buf))
    } catch {
      // Not encrypted, perhaps: it was written while the keychain couldn't be reached.
    }
  }
  try {
    return parse(buf.toString('utf8'))
  } catch {
    return null
  }
}

function load() {
  if (cache) return cache
  const file = path.join(userDir(), FILE)
  let buf: Buffer
  try {
    buf = fs.readFileSync(file)
  } catch (err) {
    // Nothing saved yet. Anything else (another program holds the file for a moment) isn't an answer to remember:
    // the keys read as missing this once, and are looked for again the next time.
    return (err as NodeJS.ErrnoException).code === 'ENOENT' ? (cache = {}) : {}
  }
  cache = decode(buf)
  if (cache) return cache
  // Damaged, or encrypted under a keychain that isn't this one. It stays where it is (it reads again by itself if the
  // keychain comes back) until a key is saved over it; a copy is kept beside it for then, and the user is told — once
  // for each damaged file — why their keys are gone.
  const copy = keepUnreadable(file)
  console.warn(`The saved keys can’t be read.${copy ? ` The file is kept as ${copy.path}.` : ''}`)
  if (copy?.fresh) {
    try {
      const tell = () =>
        void dialog
          .showMessageBox({
            type: 'warning',
            title: 'Lumen',
            message: 'Your saved keys couldn’t be read',
            detail: `The API keys and sign-ins saved on this computer can’t be read: the file is damaged, or was saved under another account or keychain.\n\nEnter them again in Settings.\n\nThe old file is kept as:\n${copy.path}`,
          })
          .catch(() => {})
      if (app.isReady()) tell()
      else void app.whenReady().then(tell)
    } catch {
      // Telling is best-effort.
    }
  }
  return (cache = {})
}

export function getSecret(name: string): string | undefined {
  return load()[name]
}

export function setSecret(name: string, value: string | null) {
  const all = load()
  // The file is there but couldn't be opened: writing now would replace every saved key with this one.
  if (!cache) throw new Error('The saved keys can’t be opened right now. Try again in a moment.')
  if (value) all[name] = value
  else delete all[name]
  const json = JSON.stringify(all)
  writeFileAtomic(path.join(userDir(), FILE), safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(json) : Buffer.from(json, 'utf8'))
}

export const secretHint = (value: string | undefined) => (value ? `…${value.slice(-4)}` : undefined)
