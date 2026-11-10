import { beforeEach, describe, expect, it } from 'vitest'
import { chapterAt, chapters, clockTime, exportMarkers, filterMarkers, markerCounts } from './markers'
import { getProject } from './store'
import { add, addAsset, freshProject, refusal, run } from './test-helpers'

const markers = () => getProject().markers
const marker = (id: string) => markers().find((m) => m.id === id)!

beforeEach(() => {
  freshProject('Film')
  addAsset('long', 600)
  add('Main', 0, 3000, { assetId: 'long' })
})

describe('marker kinds', () => {
  it('names and colours a marker by what it is for', () => {
    const chapter = run('marker.add', { frame: 300, kind: 'chapter' }) as string
    const todo = run('marker.add', { frame: 600, kind: 'todo', label: 'Fix the jump cut', note: 'Cover it with B-roll' }) as string
    const plain = run('marker.add', { frame: 900 }) as string
    expect(marker(chapter)).toMatchObject({ label: 'Chapter 1', kind: 'chapter', color: 'sky' })
    expect(marker(todo)).toMatchObject({ label: 'Fix the jump cut', kind: 'todo', color: 'amber', note: 'Cover it with B-roll' })
    // Plain markers look exactly as they did before kinds.
    expect(marker(plain)).toEqual({ id: plain, frame: 900, label: 'Marker 3', color: 'lime' })
  })

  it('ticks to-dos off, and only to-dos', () => {
    const todo = run('marker.add', { frame: 600, kind: 'todo' }) as string
    const comment = run('marker.add', { frame: 700, kind: 'comment' }) as string
    run('marker.update', { id: todo, patch: { done: true } })
    expect(marker(todo).done).toBe(true)
    run('marker.update', { id: todo, patch: { done: false } })
    expect('done' in marker(todo)).toBe(false)
    expect(refusal('marker.update', { id: comment, patch: { done: true } })).toMatch(/to-do/)
  })

  it('changes kind, taking the new kind’s colour unless the colour was chosen', () => {
    const id = run('marker.add', { frame: 100, kind: 'todo' }) as string
    run('marker.update', { id, patch: { done: true } })
    run('marker.update', { id, patch: { kind: 'chapter' } })
    expect(marker(id)).toMatchObject({ kind: 'chapter', color: 'sky' })
    expect('done' in marker(id)).toBe(false)
    run('marker.update', { id, patch: { color: 'pink' } })
    run('marker.update', { id, patch: { kind: null } })
    expect(marker(id).kind).toBeUndefined()
    expect(marker(id).color).toBe('pink')
    run('marker.update', { id, patch: { note: '  ' } })
    expect('note' in marker(id)).toBe(false)
  })

  it('filters by kind, text and what is still open', () => {
    run('marker.add', { frame: 0, kind: 'chapter', label: 'Cold open' })
    const done = run('marker.add', { frame: 100, kind: 'todo', label: 'Level the audio' }) as string
    run('marker.add', { frame: 200, kind: 'todo', label: 'Replace the stock shot', note: 'the drone one' })
    run('marker.add', { frame: 300, kind: 'comment', label: 'Love this take' })
    run('marker.add', { frame: 400 })
    run('marker.update', { id: done, patch: { done: true } })
    const all = markers()
    expect(filterMarkers(all, { kinds: ['todo'] }).map((m) => m.label)).toEqual(['Level the audio', 'Replace the stock shot'])
    expect(filterMarkers(all, { kinds: ['todo'], hideDone: true }).map((m) => m.label)).toEqual(['Replace the stock shot'])
    expect(filterMarkers(all, { text: 'DRONE' }).map((m) => m.label)).toEqual(['Replace the stock shot'])
    expect(filterMarkers(all, { kinds: ['plain', 'comment'] })).toHaveLength(2)
    expect(filterMarkers(all, { from: 100, to: 300 })).toHaveLength(2)
    expect(markerCounts(all)).toEqual({ chapter: 1, todo: 2, comment: 1, plain: 1, open: 1 })
  })
})

describe('chapters', () => {
  it('divide the whole timeline into sections', () => {
    run('marker.add', { frame: 900, kind: 'chapter', label: 'Setup' })
    run('marker.add', { frame: 1800, kind: 'chapter', label: 'Payoff' })
    run('marker.add', { frame: 1200, kind: 'comment' })
    const list = chapters(getProject())
    expect(list.map((c) => [c.title, c.start, c.end])).toEqual([
      ['Opening', 0, 900],
      ['Setup', 900, 1800],
      ['Payoff', 1800, 3000],
    ])
    expect(chapterAt(list, 1799)?.title).toBe('Setup')
    expect(chapterAt(list, 1800)?.title).toBe('Payoff')
    expect(chapters({ ...getProject(), markers: [] })).toEqual([])
  })

  it('export as a chapter list a video site takes, saying what it would refuse', () => {
    run('marker.add', { frame: 900, kind: 'chapter', label: 'Setup' })
    run('marker.add', { frame: 1000, kind: 'chapter', label: 'Too short' })
    const out = exportMarkers(getProject(), 'youtube')
    expect(out.text).toBe('0:00 Intro\n0:30 Setup\n0:33 Too short\n')
    expect(out.count).toBe(3)
    expect(out.warnings.join(' ')).toMatch(/“Setup” is shorter than 10 seconds/)
    expect(exportMarkers({ ...getProject(), markers: [] }, 'youtube').warnings[0]).toMatch(/no chapter markers/)
  })

  it('writes hours once the film runs past one', () => {
    expect(clockTime(30 * 75, 30)).toBe('1:15')
    expect(clockTime(30 * 3725, 30)).toBe('1:02:05')
    expect(clockTime(30 * 75, 30, true)).toBe('0:01:15')
  })
})

describe('marker lists', () => {
  beforeEach(() => {
    run('marker.add', { frame: 0, kind: 'chapter', label: 'Intro' })
    const todo = run('marker.add', { frame: 45, kind: 'todo', label: 'Trim, then "polish"', note: 'line one\nline two' }) as string
    run('marker.add', { frame: 90, kind: 'todo', label: 'Mix' })
    run('marker.update', { id: todo, patch: { done: true } })
  })

  it('markdown groups them, with to-dos as a checklist', () => {
    const { text } = exportMarkers(getProject(), 'markdown')
    expect(text).toContain('## Chapters\n\n- `00:00:00:00` Intro')
    expect(text).toContain('- [x] `00:00:01:15` Trim, then "polish" — line one line two')
    expect(text).toContain('- [ ] `00:00:03:00` Mix')
  })

  it('csv quotes what needs quoting', () => {
    const { text, count } = exportMarkers(getProject(), 'csv', { kinds: ['todo'] })
    expect(count).toBe(2)
    const rows = text.replace('\uFEFF', '').trim().split('\r\n')
    expect(rows[0]).toBe('Timecode,Seconds,Kind,Label,Note,Done,Color')
    expect(rows[1]).toBe('00:00:01:15,1.500,todo,"Trim, then ""polish""","line one\nline two",yes,amber')
  })

  it('json keeps everything', () => {
    const data = JSON.parse(exportMarkers(getProject(), 'json').text)
    expect(data.fps).toBe(30)
    expect(data.markers[1]).toMatchObject({ frame: 45, seconds: 1.5, kind: 'todo', done: true, note: 'line one\nline two' })
    expect(data.markers[0].done).toBeUndefined()
  })
})
