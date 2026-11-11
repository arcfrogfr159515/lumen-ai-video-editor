import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '', isReady: () => true, getLocale: () => 'zh-CN' } }))

const places = (s: string) => new Set([...s.matchAll(/\{(\d+)\}/g)].map((m) => m[1]))

describe('what the main process says', () => {
  it('is English where the tests run, whatever the computer is set to', async () => {
    const { language, mt } = await import('./i18n')
    expect(language()).toBe('en')
    expect(mt('Save changes to “{0}”?', 'Film')).toBe('Save changes to “Film”?')
    expect(mt('A sentence with no translation')).toBe('A sentence with no translation')
  })

  it('has a Chinese sentence for every one the code says, asking only for the values given', async () => {
    const { default: zhCN } = await import('./locales/zh-CN')
    const said = new Set<string>()
    const walk = (dir: string) => {
      for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name)
        if (fs.statSync(full).isDirectory()) walk(full)
        else if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name) && !full.includes(`${path.sep}locales${path.sep}`) && name !== 'i18n.ts') {
          for (const m of fs.readFileSync(full, 'utf8').matchAll(/\bmt\(\s*'((?:[^'\\]|\\.)*)'/g)) said.add(JSON.parse(`"${m[1].replace(/\\'/g, "'").replace(/"/g, '\\"')}"`) as string)
        }
      }
    }
    walk(__dirname)
    expect(said.size).toBeGreaterThan(40)
    expect([...said].filter((s) => !(s in zhCN))).toEqual([])
    // And nothing in the dictionary that nothing says any more.
    expect(Object.keys(zhCN).filter((k) => !said.has(k))).toEqual([])
    expect(Object.entries(zhCN).filter(([en, zh]) => [...places(zh)].some((p) => !places(en).has(p)) || zh !== zh.trim() || !zh).map(([en]) => en)).toEqual([])
  })
})
