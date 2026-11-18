import { describe, expect, it } from 'vitest'
import { fallbackDescription, parseSkill, skillSlug, writeSkill } from './skills'

describe('SKILL.md', () => {
  it('reads the name, description and body', () => {
    const s = parseSkill('---\nname: brand-titles\ndescription: Use when adding titles for Acme.\n---\n\n# Titles\n\nUse Fraunces.\n')
    expect(s).toEqual({ name: 'brand-titles', description: 'Use when adding titles for Acme.', body: '# Titles\n\nUse Fraunces.' })
  })

  it('tolerates quotes, CRLF, a BOM, folded lines and no frontmatter', () => {
    const s = parseSkill('﻿---\r\nname: "Quoted Name"\r\ndescription: >\r\n  Folded across\r\n  two lines\r\n---\r\nBody\r\n')
    expect(s.name).toBe('Quoted Name')
    expect(s.description).toBe('Folded across two lines')
    expect(s.body).toBe('Body')
    expect(parseSkill('Just text').body).toBe('Just text')
  })

  it('writes what it reads', () => {
    const text = writeSkill('my skill', 'Use for tests\nand more', 'Do the thing.')
    expect(parseSkill(text)).toEqual({ name: 'my skill', description: 'Use for tests and more', body: 'Do the thing.' })
  })

  it('makes folder names and fallback descriptions', () => {
    expect(skillSlug('Brand Titles — Acme!')).toBe('brand-titles-acme')
    expect(skillSlug('***')).toBe('skill')
    expect(fallbackDescription('# Heading\n\nFirst   real\nparagraph.\n\nSecond.')).toBe('First real paragraph.')
  })

  it('gives a name in another script a folder of its own', () => {
    // Both were "skill", so the second skill with a Chinese name was refused as already there.
    expect(skillSlug('调色技巧')).toBe('调色技巧')
    expect(skillSlug('短视频剪辑')).toBe('短视频剪辑')
    // And these two were both "a".
    expect(skillSlug('剪辑 A')).toBe('剪辑-a')
    expect(skillSlug('调色 A')).toBe('调色-a')
    expect(skillSlug('字幕 v2：双语')).toBe('字幕-v2双语')
    // Accents still come off, as before.
    expect(skillSlug('Étalonnage café')).toBe('etalonnage-cafe')
  })

  it('makes a folder name Windows can make', () => {
    expect(skillSlug('CON')).toBe('skill-con')
    expect(skillSlug('com1')).toBe('skill-com1')
    expect(skillSlug('  - spaced out -  ')).toBe('spaced-out')
    // 64 characters, counted as characters: an emoji-free name in a script outside the basic plane is not cut in half.
    const long = skillSlug('𠀀'.repeat(80))
    expect([...long]).toHaveLength(64)
    expect(long).toBe('𠀀'.repeat(64))
  })
})
