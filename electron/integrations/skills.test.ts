import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

// The "Import a skill folder" dialog answers with whatever folder the test says; each test has a profile of its own.
const env = vi.hoisted(() => ({ root: '', picked: '' }))

vi.mock('electron', () => ({
  app: { getPath: (name: string) => `${env.root}/${name}` },
  dialog: { showOpenDialog: async () => ({ canceled: !env.picked, filePaths: env.picked ? [env.picked] : [] }) },
  shell: {},
}))

const { importSkill, readSkill } = await import('./skills')

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-skills-'))
afterAll(() => fs.rmSync(base, { recursive: true, force: true }))

let profiles = 0
beforeEach(() => {
  env.root = path.join(base, `profile-${++profiles}`)
  env.picked = ''
})

/** A skill folder with a file it refers to, and the things an import leaves behind: hidden files, installed packages. */
function skillAt(dir: string, name: string) {
  fs.mkdirSync(path.join(dir, 'refs', '.cache'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'node_modules', 'left-pad'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: Use for titles.\n---\n\nUse Fraunces.\n`)
  fs.writeFileSync(path.join(dir, 'refs', 'palette.md'), '# Palette')
  fs.writeFileSync(path.join(dir, 'refs', '.cache', 'seen.md'), 'cache')
  fs.writeFileSync(path.join(dir, '.DS_Store'), 'x')
  fs.writeFileSync(path.join(dir, 'node_modules', 'left-pad', 'index.js'), '')
  return dir
}

const imported = (folder: string) => path.join(env.root, 'userData', 'skills', folder)

describe('importing a skill folder', () => {
  it('copies the skill without its hidden files and installed packages', async () => {
    env.picked = skillAt(path.join(base, 'plain', 'brand-titles'), 'Brand titles')
    expect(await importSkill(null)).toEqual({ key: 'user:brand-titles', source: 'user', folder: 'brand-titles', name: 'Brand titles', description: 'Use for titles.', files: ['refs/palette.md'] })
    expect(fs.existsSync(path.join(imported('brand-titles'), 'refs', 'palette.md'))).toBe(true)
    expect(fs.existsSync(path.join(imported('brand-titles'), '.DS_Store'))).toBe(false)
    expect(fs.existsSync(path.join(imported('brand-titles'), 'refs', '.cache'))).toBe(false)
    expect(fs.existsSync(path.join(imported('brand-titles'), 'node_modules'))).toBe(false)
    expect(readSkill('user', 'brand-titles').body).toBe('Use Fraunces.')
  })

  it('imports a skill kept inside an installed package, or in a folder whose name begins with a dot', async () => {
    // What a copy leaves out was decided by each file's whole path — the path of the folder being imported included.
    // For a skill under node_modules, or in a folder called ".titles", that left out everything: nothing was copied,
    // and the import ended in "Cannot destructure property 'body' of null".
    env.picked = skillAt(path.join(base, 'project', 'node_modules', '@acme', 'lumen-skills', 'brand-titles'), 'Brand titles')
    expect(await importSkill(null)).toMatchObject({ folder: 'brand-titles', name: 'Brand titles', files: ['refs/palette.md'] })
    env.picked = skillAt(path.join(base, 'home', '.lower-thirds'), 'Lower thirds')
    expect(await importSkill(null)).toMatchObject({ folder: 'lower-thirds', name: 'Lower thirds', files: ['refs/palette.md'] })
    // A folder inside one whose name begins with a dot was always fine, and still is.
    env.picked = skillAt(path.join(base, 'home', '.agent', 'colour'), 'Colour')
    expect(await importSkill(null)).toMatchObject({ folder: 'colour', name: 'Colour', files: ['refs/palette.md'] })
    // What is inside the skill is still sorted the same way.
    for (const folder of ['brand-titles', 'lower-thirds', 'colour']) {
      expect(fs.existsSync(path.join(imported(folder), 'refs', 'palette.md'))).toBe(true)
      expect(fs.existsSync(path.join(imported(folder), '.DS_Store'))).toBe(false)
      expect(fs.existsSync(path.join(imported(folder), 'refs', '.cache'))).toBe(false)
      expect(fs.existsSync(path.join(imported(folder), 'node_modules'))).toBe(false)
    }
  })

  it('gives a second skill of the same name a folder of its own, and refuses a folder that is not a skill', async () => {
    env.picked = skillAt(path.join(base, 'one', 'titles'), 'Titles')
    expect((await importSkill(null))?.folder).toBe('titles')
    env.picked = skillAt(path.join(base, 'two', 'titles'), 'Titles')
    expect((await importSkill(null))?.folder).toBe('titles-2')
    env.picked = fs.mkdtempSync(path.join(base, 'empty-'))
    await expect(importSkill(null)).rejects.toThrow(/no SKILL\.md/)
    env.picked = ''
    expect(await importSkill(null)).toBeNull()
  })
})
