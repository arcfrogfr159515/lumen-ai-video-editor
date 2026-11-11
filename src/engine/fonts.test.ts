import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Project, ProjectFont } from '@/editor/types'
import { bytesToBase64, fontFileUrl, holdFonts, registerProjectFonts } from './fonts'

/** The page's side of it: the faces it holds, and the URLs that keep a copy of a file alive. */
const page = { faces: new Set<{ family: string }>(), urls: new Set<string>(), made: 0 }

class FakeFace {
  constructor(public family: string, public data: Uint8Array) {}
  load = () => Promise.resolve(this)
}
vi.stubGlobal('FontFace', FakeFace)
vi.stubGlobal('document', { fonts: { add: (f: FakeFace) => page.faces.add(f), delete: (f: FakeFace) => page.faces.delete(f) } })
vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
  const url = `blob:font-${++page.made}`
  page.urls.add(url)
  return url
})
vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url) => void page.urls.delete(url))

const font = (id: string): ProjectFont => ({ id, name: id, family: `Lumen ${id}`, fileName: `${id}.ttf`, data: bytesToBase64(new Uint8Array([1, 2, 3, 4])) })
const holding = (...ids: string[]): Pick<Project, 'fonts'> => ({ fonts: Object.fromEntries(ids.map((id) => [id, font(id)])) })
const families = () => [...page.faces].map((f) => f.family).sort()

beforeEach(() => {
  registerProjectFonts({})
  expect(page.faces.size + page.urls.size).toBe(0)
})

describe('the fonts a project embeds', () => {
  it('are registered once each, and their file is handed out under one URL', () => {
    const p = holding('a', 'b')
    registerProjectFonts(p)
    registerProjectFonts(p)
    expect(families()).toEqual(['Lumen a', 'Lumen b'])
    expect(fontFileUrl(p, 'custom:a')).toBe(fontFileUrl(p, 'custom:a'))
    expect(page.urls.size).toBe(1)
  })

  it('are let go of when the project no longer holds them', () => {
    const p = holding('a', 'b')
    registerProjectFonts(p)
    const a = fontFileUrl(p, 'custom:a')!
    const b = fontFileUrl(p, 'custom:b')!
    // One is taken out of the project.
    registerProjectFonts(holding('b'))
    expect(families()).toEqual(['Lumen b'])
    expect([...page.urls]).toEqual([b])
    expect(page.urls.has(a)).toBe(false)
    // Another project is opened.
    registerProjectFonts(holding('c'))
    expect(families()).toEqual(['Lumen c'])
    expect(page.urls.size).toBe(0)
  })

  it('come back when the removal is undone', () => {
    const p = holding('a')
    registerProjectFonts(p)
    const first = fontFileUrl(p, 'custom:a')
    registerProjectFonts({})
    registerProjectFonts(p)
    expect(families()).toEqual(['Lumen a'])
    const second = fontFileUrl(p, 'custom:a')
    expect(second).not.toBe(first)
    expect([...page.urls]).toEqual([second])
  })

  it('don’t pile up over a session of opening projects', () => {
    for (let i = 0; i < 40; i++) {
      const p = holding(`p${i}-a`, `p${i}-b`, `p${i}-c`)
      registerProjectFonts(p)
      for (const id of Object.keys(p.fonts!)) fontFileUrl(p, `custom:${id}`)
    }
    expect(page.faces.size).toBe(3)
    expect(page.urls.size).toBe(3)
  })

  it('stay while an export is drawing with them, and go once it is done', () => {
    const p = holding('a', 'b')
    registerProjectFonts(p)
    const a = fontFileUrl(p, 'custom:a')!
    const first = holdFonts()
    const second = holdFonts()
    registerProjectFonts(holding('c'))
    expect(families()).toEqual(['Lumen a', 'Lumen b', 'Lumen c'])
    expect(page.urls.has(a)).toBe(true)
    first()
    first()
    expect(families()).toEqual(['Lumen a', 'Lumen b', 'Lumen c'])
    second()
    expect(families()).toEqual(['Lumen c'])
    expect(page.urls.size).toBe(0)
  })
})
