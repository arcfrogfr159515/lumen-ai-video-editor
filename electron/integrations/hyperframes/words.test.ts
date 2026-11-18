import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: (name: string) => `nowhere/${name}`, once: () => {} }, session: {}, BrowserWindow: class {}, screen: {} }))

const { buildTemplate, readingTime, templateDuration } = await import('./templates')

const frame = { width: 1920, height: 1080, duration: 4 }
/** What a template writes inside the element of class `cls`, tags and all. */
const inside = (html: string, cls: string) => new RegExp(`<(div|h1) class="${cls}">([\\s\\S]*?)</\\1>`).exec(html)?.[2] ?? ''
/** The words a template animates one by one: what stands in each `.w`. */
const animated = (html: string) => [...html.matchAll(/<span class="w(?: hot)?">(?:<em>)?([^<]*)/g)].map((m) => m[1])
const said = (html: string) => html.replace(/<[^>]+>/g, '')

const CHINESE = '让每一帧都精彩'

describe('a motion graphic of words in a script written without spaces', () => {
  it('shows kinetic type a word at a time', () => {
    // Words were what stands between spaces. A Chinese line has none: all of it was one word, set on one line that
    // doesn't break, in letters a sixth of the frame high.
    const words = animated(buildTemplate('kinetic', { text: CHINESE }, frame))
    expect(words.length).toBeGreaterThanOrEqual(4)
    expect(words.join('')).toBe(CHINESE)
    for (const w of words) expect([...w].length, w).toBeLessThanOrEqual(3)
  })

  it('stacks kinetic type in rows of two words, written without a space between them', () => {
    const html = buildTemplate('kinetic', { text: CHINESE, style: 'stack' }, frame)
    const rows = [...html.matchAll(/<div class="row">([\s\S]*?)<\/div>/g)].map((m) => said(m[1]))
    expect(rows.length).toBeGreaterThanOrEqual(2)
    expect(rows.join('')).toBe(CHINESE)
  })

  it('wipes a quote, a chapter and a title on word by word, and adds no spaces to them', () => {
    const quote = buildTemplate('quote', { text: '简单是终极的复杂。' }, frame)
    expect(animated(inside(quote, 'text')).length).toBeGreaterThanOrEqual(3)
    expect(said(inside(quote, 'text'))).toBe('简单是终极的复杂。')
    // A space the writer put in is kept, and none is added.
    const chapter = buildTemplate('chapter', { title: '第一章 出发前的准备' }, frame)
    expect(said(inside(chapter, 'title'))).toBe('第一章 出发前的准备')
    expect(animated(inside(chapter, 'title')).length).toBeGreaterThanOrEqual(3)
    const title = buildTemplate('title-card', { title: '山里的*日出*' }, frame)
    expect(said(inside(title, 'title'))).toBe('山里的日出')
    // The word marked with stars is the one set apart.
    expect(inside(title, 'title')).toContain('<em>日出</em>')
  })

  it('stays up long enough to be read', () => {
    // A word a third of a second: forty characters counted as one word.
    const long = '我们今天开车去山里看日出，天气非常好，大家都很开心，一路上有说有笑，傍晚才回到城里。'
    expect(readingTime(long)).toBeGreaterThan(5)
    expect(templateDuration('quote', { text: long })).toBeGreaterThan(6)
  })
})

describe('a motion graphic of words in a script written with spaces', () => {
  it('is as before', () => {
    expect(animated(buildTemplate('kinetic', { text: 'Make every *frame* count' }, frame))).toEqual(['Make', 'every', 'frame', 'count'])
    const html = buildTemplate('kinetic', { text: 'Make every frame count', style: 'stack' }, frame)
    expect([...html.matchAll(/<div class="row">([\s\S]*?)<\/div>/g)].map((m) => said(m[1]))).toEqual(['Make every', 'frame count'])
    const quote = buildTemplate('quote', { text: 'Simplicity is the ultimate sophistication.' }, frame)
    expect(said(inside(quote, 'text'))).toBe('Simplicity is the ultimate sophistication.')
    expect(animated(inside(quote, 'text'))).toEqual(['Simplicity', 'is', 'the', 'ultimate', 'sophistication.'])
    expect(inside(buildTemplate('title-card', { title: 'A *bold* start' }, frame), 'title')).toContain('<em>bold</em>')
    expect(readingTime('Make every frame count')).toBeCloseTo(2.2)
    expect(templateDuration('quote', { text: 'Simplicity is the ultimate sophistication.' })).toBe(6)
  })
})
