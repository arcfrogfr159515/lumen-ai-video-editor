import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'

const env = vi.hoisted(() => ({ root: '' }))
vi.mock('electron', () => ({ app: { getPath: (name: string) => `${env.root}/${name}` } }))

env.root = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-attach-encoding-test-')).replace(/\\/g, '/')
const { attachmentContent, saveAttachment } = await import('./attachments')

afterAll(() => fs.rmSync(env.root, { recursive: true, force: true }))

const NOTES = '剪辑笔记\r\nCut the intro — keep “hello”.\r\n'
/** The same notes as each way of saving them writes the file. */
const SAVED: Record<string, Buffer> = {
  'UTF-8': Buffer.from(NOTES, 'utf8'),
  'UTF-8 with a byte order mark': Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(NOTES, 'utf8')]),
  // What Notepad saves as “Unicode” / “UTF-16 LE”.
  'UTF-16, low byte first': Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(NOTES, 'utf16le')]),
  'UTF-16, high byte first': Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(NOTES, 'utf16le').swap16()]),
}

describe('a text file attached to a message, however it was saved', () => {
  for (const [saved, bytes] of Object.entries(SAVED)) {
    it(`goes to the model as its text — ${saved}`, () => {
      // A file in UTF-16 opens with a mark that says so. It was read as UTF-8 all the same — an empty character
      // after every letter — and refused: "isn’t a text file".
      const meta = saveAttachment('chat-encodings', { name: 'notes.txt', mime: 'text/plain', data: bytes })
      expect(meta).toMatchObject({ kind: 'text', chars: NOTES.length })
      expect(attachmentContent('chat-encodings', meta.id)?.text).toBe(NOTES)
    })
  }

  it('is read as far as it goes when a UTF-16 file was cut off in the middle of a character', () => {
    const meta = saveAttachment('chat-encodings', { name: 'cut.txt', data: Buffer.concat([SAVED['UTF-16, low byte first'], Buffer.from([0x41])]) })
    expect(attachmentContent('chat-encodings', meta.id)?.text).toBe(NOTES)
  })

  it('is still refused when it isn’t text at all', () => {
    expect(() => saveAttachment('chat-encodings', { name: 'data.txt', data: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x08, 0x00]) })).toThrow(/“data\.txt” isn’t a text file/)
    // A mark and then what isn't text either.
    expect(() => saveAttachment('chat-encodings', { name: 'odd.txt', data: Buffer.from([0xff, 0xfe, 0x41, 0x00, 0x00, 0x00, 0x42, 0x00]) })).toThrow(/“odd\.txt” isn’t a text file/)
  })
})
