import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import zhCN from '@/locales/zh-CN'
import { counted, fill, language, languageFor, tm, translation, tt, ttc } from './i18n'

const places = (s: string) => new Set([...s.matchAll(/\{(\d+)\}/g)].map((m) => m[1]))

describe('what the interface says', () => {
  it('is English as it is written, where the tests run', () => {
    expect(language).toBe('en')
    expect(tt('Save a copy')).toBe('Save a copy')
    expect(tt('{0} of {1}', 2, 5)).toBe('2 of 5')
    expect(tm('Transitions')).toBe('Transitions')
    expect(ttc('fade', 'In')).toBe('In')
    expect([counted(1, 'clip'), counted(3, 'clip'), counted(2, 'sliver has', 'slivers have')]).toEqual(['1 clip', '3 clips', '2 slivers have'])
  })

  it('puts values where their places are, in whatever order the sentence has them', () => {
    expect(fill('{1} — {0}', ['a', 'b'])).toBe('b — a')
    expect(fill('{0}{0}', ['x'])).toBe('xx')
    // A place nothing was given for stays as written, and so does what only looks like one.
    expect(fill('{0} and {1}', ['x'])).toBe('x and {1}')
    expect(fill('Shot {nn}', [7])).toBe('Shot {nn}')
    expect(fill('{0}', [0])).toBe('0')
    expect(fill('nothing to fill', [])).toBe('nothing to fill')
  })

  it('answers in Chinese from the dictionary, and in English where it has nothing', () => {
    expect(translation('Save', 'zh-CN')).toBe('保存')
    expect(fill(translation('Undo {0}', 'zh-CN'), ['分割'])).toBe('撤销：分割')
    expect(translation('A sentence nobody has translated', 'zh-CN')).toBe('A sentence nobody has translated')
    expect(translation('Save', 'en')).toBe('Save')
  })

  it('knows which of the computer’s languages it speaks', () => {
    expect(['en', 'en-GB', 'EN_us'].map(languageFor)).toEqual(['en', 'en', 'en'])
    expect(['zh', 'zh-CN', 'zh-Hans-CN', 'zh-SG'].map(languageFor)).toEqual(['zh-CN', 'zh-CN', 'zh-CN', 'zh-CN'])
    // Traditional characters are another translation, which there isn't yet.
    expect(['zh-TW', 'zh-Hant', 'zh-HK', 'zh-Hant-MO'].map(languageFor)).toEqual([null, null, null, null])
    expect(['fr', 'ja-JP', ''].map(languageFor)).toEqual([null, null, null])
  })
})

describe('the Chinese dictionary', () => {
  const entries = Object.entries(zhCN)

  it('asks only for values its English gives', () => {
    const wrong = entries.filter(([en, zh]) => [...places(zh)].some((p) => !places(en).has(p))).map(([en]) => en)
    expect(wrong).toEqual([])
  })

  it('has no entry that only repeats the English, or that is padded with spaces', () => {
    expect(entries.filter(([en, zh]) => en === zh).map(([en]) => en)).toEqual([])
    expect(entries.filter(([, zh]) => zh !== zh.trim()).map(([en]) => en)).toEqual([])
  })

  it('keeps what the code takes a sentence apart by', () => {
    // The export dialog shows the part of a codec’s label before " —".
    for (const en of ['H.264 — plays everywhere', 'HEVC (H.265) — smaller files', 'AV1 — best compression', 'VP9 — open, widely supported']) {
      expect(zhCN[en], en).toContain(' —')
      expect(zhCN[en].split(' —')[0]).toBe(en.split(' —')[0])
    }
  })

  /** Every source file of the interface, with its text. */
  const root = path.resolve(__dirname, '..')
  const sources = (dir = root): [string, string][] =>
    fs.readdirSync(dir).flatMap((name): [string, string][] => {
      const full = path.join(dir, name)
      if (fs.statSync(full).isDirectory()) return sources(full)
      if (!/\.tsx?$/.test(name) || /\.test\.tsx?$/.test(name) || full.includes(`${path.sep}locales${path.sep}`) || /i18n(-react)?\.ts$/.test(name)) return []
      return [[full, fs.readFileSync(full, 'utf8')]]
    })

  it('covers what the source says', () => {
    const said = new Set<string>()
    for (const [, text] of sources()) {
      for (const m of text.matchAll(/\b(?:ttx?|tm)\(\s*'((?:[^'\\]|\\.)*)'/g)) said.add(JSON.parse(`"${m[1].replace(/\\'/g, "'").replace(/"/g, '\\"')}"`) as string)
    }
    expect(said.size).toBeGreaterThan(2500)
    // Names and the like, the same in every language. Anything else found here is a sentence waiting for a translation.
    const same = new Set(['Lumen', 'Copilot', 'AI', 'GPU', 'CPU', 'RGB', 'HSL', 'LUT', 'PDF', 'Aa', 'px', 'dB', 'ms', 'Hz', 'Mbps', 'CFR', 'VFR', 'GIF', 'PNG', 'MP4', 'MOV', 'WebM', 'WAV', 'SRT', 'WebVTT', 'Markdown', 'JSON', 'Blender', 'HyperFrames', 'ElevenLabs', 'Claude Code', 'Claude Opus 5.5', 'AsyncTech', 'Ada Lovelace', '4K UHD', 'GPT Image', 'Multilingual v2', 'Flash v2.5', 'ElevenLabs Scribe', 'OpenAI Whisper', 'Geist', 'Geist Mono', 'Fraunces', 'Archivo', 'Syne', 'Space Grotesk', 'Caveat', 'Instrument', 'Instrument Serif', 'Bricolage', 'Bricolage Grotesque', 'sk_…', 'API_KEY=…', 'Authorization: Bearer …', '.mcp.json', 'npx -y @modelcontextprotocol/server-everything', '@hyperframes/core runtime · Apache-2.0', 'C:\\Program Files\\Blender Foundation\\Blender 5.1\\blender.exe', 'CFR {0}%', '{0} fps', '{0} dB', '{0}{1}', '{0} ({1} fps).mp4', '{0}×{1} · {2} fps', '{0}×{1} · {2} fps · {3}', '{0}×{1} · {2} · {3} fps{4}', '{0} fps{1}', '· {0} · {1} Mbps', 'GitHub ↗'])
    const waiting = [...said].filter((s) => !(s in zhCN) && !same.has(s))
    expect(waiting).toEqual([])
  })

  it('is asked for everything a toast says', () => {
    // The check above sees only what is given to tt(). A sentence handed to a toast as it is written — its title,
    // its description, its button — is shown in English whatever the language, and nothing notices.
    const word = /[A-Za-z]{2,}/
    // Words of a template's own — or words quoted inside one of its ${…}, other than a comparison or what goes to the dictionary.
    const picked = (code: string) => /(['"])[^'"]*[A-Za-z]{2,}[^'"]*\1/.test(code.replace(/\b(?:ttx?|tm|ttc|plural|counted)\([^)]*\)/g, '').replace(/[!=]==?\s*(['"])[^'"]*\1/g, ''))
    const words = (literal: string) => word.test(literal.replace(/\$\{[^}]*\}/g, '')) || [...literal.matchAll(/\$\{([^}]*)\}/g)].some((m) => picked(m[1]))
    const quoted = String.raw`(['"\`])((?:(?!\1)[^\\]|\\.)*)\1`
    const title = new RegExp(String.raw`\b(?:toast(?:\.\w+)?|withProgress|withMatteProgress)\(\s*` + quoted, 'g')
    const option = new RegExp(String.raw`\b(?:description|label):\s*` + quoted, 'g')
    // A sentence made from another by swapping its ending: "Removing…" → "Removing failed" works in one language.
    const glued = /\.replace\([^)]*,\s*(['"])[^'"]*[A-Za-z]{2,}[^'"]*\1\)/
    const bare: string[] = []
    for (const [full, text] of sources()) {
      text.split('\n').forEach((line, i) => {
        const toast = /\btoast\b/.test(line)
        const found = [...line.matchAll(title), ...(toast ? line.matchAll(option) : [])]
        if (found.some((m) => words(m[2])) || (toast && glued.test(line))) bare.push(`${path.relative(root, full)}:${i + 1}`)
      })
    }
    expect(bare).toEqual([])
  })
})
