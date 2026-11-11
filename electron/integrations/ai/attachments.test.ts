import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { afterAll, describe, expect, it, vi } from 'vitest'

const env = vi.hoisted(() => ({ root: '' }))
vi.mock('electron', () => ({ app: { getPath: (name: string) => `${env.root}/${name}` } }))

env.root = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-attach-test-')).replace(/\\/g, '/')
const { docxText, saveAttachment, unzipEntry } = await import('./attachments')

afterAll(() => fs.rmSync(env.root, { recursive: true, force: true }))

/** A zip archive of the given files, the way Word writes one (deflated) or stored as they are. */
function zip(files: Record<string, string>, deflate = true): Buffer {
  const locals: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const [name, text] of Object.entries(files)) {
    const raw = Buffer.from(text, 'utf8')
    const data = deflate ? zlib.deflateRawSync(raw) : raw
    const local = Buffer.alloc(30 + name.length)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(deflate ? 8 : 0, 8)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.write(name, 30)
    const dir = Buffer.alloc(46 + name.length)
    dir.writeUInt32LE(0x02014b50, 0)
    dir.writeUInt16LE(deflate ? 8 : 0, 10)
    dir.writeUInt32LE(data.length, 20)
    dir.writeUInt32LE(raw.length, 24)
    dir.writeUInt16LE(name.length, 28)
    dir.writeUInt32LE(offset, 42)
    dir.write(name, 46)
    locals.push(local, data)
    central.push(dir)
    offset += local.length + data.length
  }
  const dir = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(central.length, 8)
  end.writeUInt16LE(central.length, 10)
  end.writeUInt32LE(dir.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, dir, end])
}

const para = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`
const document = (...paras: string[]) => `<?xml version="1.0"?><w:document><w:body>${paras.join('')}</w:body></w:document>`
const docx = (xml: string, deflate = true) => zip({ '[Content_Types].xml': '<Types/>', 'word/styles.xml': '<w:styles/>', 'word/document.xml': xml }, deflate)
const FRIENDLY = /^That Word document couldn’t be read\. Save it as PDF or text and attach that\.$/

/** What reading a file gives: its text, or the error in words. Anything else thrown is a bug. */
function read(file: Buffer): string {
  try {
    return docxText(file)
  } catch (err) {
    if (err instanceof Error && FRIENDLY.test(err.message)) return '(refused)'
    throw err
  }
}

describe('Word documents', () => {
  it('give their text: paragraphs, tabs and line breaks', () => {
    const xml = document(para('Scene one'), '<w:p><w:r><w:t>Cut</w:t><w:tab/><w:t>to</w:t><w:br/><w:t>black.</w:t></w:r></w:p>', para('Tom &amp; Ann &lt;3'))
    expect(docxText(docx(xml))).toBe('Scene one\nCut\tto\nblack.\nTom & Ann <3')
    expect(docxText(docx(xml, false))).toBe('Scene one\nCut\tto\nblack.\nTom & Ann <3')
  })

  it('read numbered characters, and leave a number that isn’t one as it is', () => {
    expect(docxText(docx(document(para('caf&#233; &#x1F3AC; &#xe9;'))))).toBe('café 🎬 é')
    // &#1114112; is past the last character there is: it used to end the read with "Invalid code point".
    expect(docxText(docx(document(para('a&#1114112;b &#0; &#55296; &#99999999999;'))))).toBe('a&#1114112;b &#0; &#55296; &#99999999999;')
  })

  it('are refused in words when the file is something else', () => {
    for (const file of [Buffer.alloc(0), Buffer.from('PK'), Buffer.from('just some text, not a zip at all, but long enough to look'), zip({ 'word/other.xml': '<x/>' })]) expect(read(file)).toBe('(refused)')
  })

  it('are refused in words wherever the file was cut short', () => {
    const whole = docx(document(para('A script of some length. '.repeat(40))))
    let refused = 0
    for (let length = 0; length < whole.length; length++) if (read(whole.subarray(0, length)) === '(refused)') refused++
    expect(refused).toBeGreaterThan(whole.length - 30)
  })

  it('are refused in words when their directory points past the end of the file', () => {
    const whole = docx(document(para('Hello')))
    const end = whole.length - 22
    const dir = whole.readUInt32LE(end + 16)
    // The entry for word/document.xml is the third: move its data to an offset the file doesn't have.
    let p = dir
    for (let n = 0; n < 2; n++) p += 46 + whole.readUInt16LE(p + 28)
    for (const offset of [whole.length - 10, whole.length, 0x7fffffff, 0xffffffff]) {
      const bad = Buffer.from(whole)
      bad.writeUInt32LE(offset, p + 42)
      expect(read(bad), String(offset)).toBe('(refused)')
    }
    // A packed size larger than what is left.
    const long = Buffer.from(whole)
    long.writeUInt32LE(0xffffffff, p + 20)
    expect(read(long)).toBe('(refused)')
    expect(unzipEntry(long, 'word/document.xml')).toBeNull()
  })

  it('never fail with anything but those words, whatever is wrong with the file', () => {
    const whole = docx(document(para('Some lines of a script. '.repeat(20))))
    let seed = 12345
    const random = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
    for (let run = 0; run < 3000; run++) {
      const bad = Buffer.from(whole)
      const flips = 1 + Math.floor(random() * 4)
      for (let f = 0; f < flips; f++) bad[Math.floor(random() * bad.length)] = Math.floor(random() * 256)
      expect(typeof read(bad)).toBe('string')
    }
  })

  it('are kept as their text when attached, or not at all', () => {
    const saved = saveAttachment('chat-1', { name: 'script.docx', mime: '', data: docx(document(para('INT. KITCHEN'))) })
    expect(saved).toMatchObject({ name: 'script.docx', kind: 'text', mime: 'text/plain', chars: 12 })
    const cut = docx(document(para('INT. KITCHEN')))
    expect(() => saveAttachment('chat-1', { name: 'cut.docx', mime: '', data: cut.subarray(0, cut.length - 40) })).toThrow(FRIENDLY)
    expect(fs.readdirSync(path.join(env.root, 'userData', 'copilot', 'attachments', 'chat-1')).filter((f) => f.endsWith('.json'))).toHaveLength(1)
  })
})
