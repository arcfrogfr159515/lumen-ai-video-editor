import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { description: string; build: { electronLanguages: string[] } }

describe('package.json', () => {
  it('ships Chromium’s language pack for every language Lumen speaks', () => {
    // What Chromium itself says (a text field's own menu, the file picker's labels) is in a language it has a pack
    // for, and English otherwise. Lumen's own language no longer depends on these — see systemLanguages in electron/i18n.ts.
    expect(pkg.build.electronLanguages).toEqual(expect.arrayContaining(['en-US', 'zh-CN']))
  })

  it('keeps the description short enough for Windows shortcuts', () => {
    // The installer writes it into the Start menu and desktop shortcuts as their comment. Past 260
    // characters it overruns into the shortcut's icon path, and Windows shows a blank icon for Lumen.
    expect(pkg.description.length).toBeLessThanOrEqual(200)
  })
})
