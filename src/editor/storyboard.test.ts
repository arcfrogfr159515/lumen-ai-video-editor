import { beforeEach, describe, expect, it } from 'vitest'
import { getProject } from './store'
import { cardMoves, sectionMove, storyboard, storyCards, storyTrack, type StoryMove } from './storyboard'
import { add, addAsset, clip, freshProject, onTrack, refusal, run, spans, trackId } from './test-helpers'

let ids: string[]

beforeEach(() => {
  freshProject('Story')
  addAsset('long', 120)
  addAsset('song', 300, 'audio')
  // Five shots of 100 frames on the main track, named A to E.
  ids = ['A', 'B', 'C', 'D', 'E'].map((name, i) => add('Main', i * 100, 100, { assetId: 'long', inPoint: i * 300, name }))
})

const order = () => onTrack('Main').map((c) => c.name).join('')
const apply = (moves: StoryMove[]) => moves.forEach((m) => run('timeline.moveRange', m))
const board = () => storyboard(getProject())

describe('moving a stretch of the timeline', () => {
  it('picks it up with everything in it and closes up behind', () => {
    const title = add('Titles', 110, 60, { kind: 'text', name: 'Over B' })
    const overE = add('Overlay', 420, 50, { assetId: 'long', name: 'Over E' })
    run('marker.add', { frame: 150, label: 'In B' })
    run('marker.add', { frame: 350, label: 'In D' })
    // B (100–200) goes to where E starts (400).
    const r = run('timeline.moveRange', { start: 100, end: 200, to: 400 }) as { movedBy: number }
    expect(r.movedBy).toBe(200)
    expect(order()).toBe('ACDBE')
    expect(spans('Main')).toEqual([
      [0, 100],
      [100, 200],
      [200, 300],
      [300, 400],
      [400, 500],
    ])
    // The title went with B; what was over E stayed over E.
    expect(clip(title).start).toBe(310)
    expect(clip(overE).start).toBe(420)
    expect(getProject().markers.map((m) => [m.label, m.frame])).toEqual([
      ['In D', 250],
      ['In B', 350],
    ])
  })

  it('moves earlier as well as later', () => {
    run('timeline.moveRange', { start: 300, end: 500, to: 0 })
    expect(order()).toBe('DEABC')
    expect(clip(ids[3])).toMatchObject({ start: 0, inPoint: 900 })
  })

  it('cuts a clip that lies across an edge of the stretch', () => {
    const over = add('Overlay', 150, 100, { assetId: 'long', name: 'Across' })
    run('timeline.moveRange', { start: 100, end: 200, to: 500 })
    // Its first half was over B and went with it; its second half was over C and stayed there.
    expect(spans('Overlay')).toEqual([
      [100, 150],
      [450, 500],
    ])
    expect(clip(over).start).toBe(450)
    expect(onTrack('Overlay')[0].inPoint).toBe(50)
  })

  it('leaves music beds whole, and their tracks as they are', () => {
    const bed = add('Music', 0, 500, { assetId: 'song' })
    const sting = add('Music', 520, 30, { assetId: 'song', inPoint: 900 })
    run('timeline.moveRange', { start: 100, end: 200, to: 400, keepWhole: [bed] })
    expect(order()).toBe('ACDBE')
    expect(spans('Music')).toEqual([
      [0, 500],
      [520, 550],
    ])
    expect(clip(sting).start).toBe(520)
    // Without it, the bed is cut up and rearranged like everything else.
    run('timeline.moveRange', { start: 100, end: 200, to: 400 })
    expect(onTrack('Music').length).toBeGreaterThan(2)
  })

  it('leaves tracks out of sync, and locked ones, where they are', () => {
    const title = add('Titles', 110, 60, { kind: 'text' })
    run('track.update', { id: trackId('Titles'), patch: { syncLock: false } })
    run('timeline.moveRange', { start: 100, end: 200, to: 400 })
    expect(clip(title).start).toBe(110)
  })

  it('carries the marked stretch along, or clears marks the move splits', () => {
    run('timeline.setRange', { range: { in: 120, out: 180 } })
    run('timeline.moveRange', { start: 100, end: 200, to: 400 })
    expect(getProject().range).toEqual({ in: 320, out: 380 })
    run('timeline.setRange', { range: { in: 80, out: 380 } })
    run('timeline.moveRange', { start: 100, end: 200, to: 500 })
    expect(getProject().range ?? null).toBeNull()
  })

  it('refuses a destination inside the stretch, and does nothing when it is already there', () => {
    expect(refusal('timeline.moveRange', { start: 100, end: 300, to: 200 })).toMatch(/outside the stretch/)
    expect(run('timeline.moveRange', { start: 100, end: 200, to: 200 })).toEqual({ movedBy: 0 })
    expect(order()).toBe('ABCDE')
  })
})

describe('the storyboard', () => {
  it('is the story track’s clips as numbered cards, one section when there are no chapters', () => {
    expect(storyTrack(getProject())?.name).toBe('Main')
    const [all] = board()
    expect(all).toMatchObject({ id: 'all', start: 0, end: 500 })
    expect(all.cards.map((c) => [c.number, c.start, c.end])).toEqual([
      [1, 0, 100],
      [2, 100, 200],
      [3, 200, 300],
      [4, 300, 400],
      [5, 400, 500],
    ])
  })

  it('divides into sections at chapter markers', () => {
    run('marker.add', { frame: 200, kind: 'chapter', label: 'Middle' })
    run('marker.add', { frame: 400, kind: 'chapter', label: 'End' })
    run('marker.add', { frame: 250, kind: 'comment' })
    expect(board().map((s) => [s.title, s.cards.map((c) => clip(c.clipId).name).join('')])).toEqual([
      ['Opening', 'AB'],
      ['Middle', 'CD'],
      ['End', 'E'],
    ])
  })

  it('falls back on the lowest video track with clips when there is no main track', () => {
    freshProject('No main')
    addAsset('long', 60)
    run('track.remove', { id: trackId('Main') })
    add('Overlay', 30, 60, { assetId: 'long' })
    expect(storyTrack(getProject())?.name).toBe('Overlay')
    expect(storyCards(board())).toHaveLength(1)
  })
})

describe('reordering cards', () => {
  it('moves one card before another', () => {
    apply(cardMoves(board(), [ids[3]], ids[1]))
    expect(order()).toBe('ADBCE')
  })

  it('moves a card to the end', () => {
    apply(cardMoves(board(), [ids[0]], null))
    expect(order()).toBe('BCDEA')
  })

  it('moves neighbours as one stretch', () => {
    const moves = cardMoves(board(), [ids[1], ids[2]], ids[4])
    expect(moves).toEqual([{ start: 300, end: 400, to: 100 }])
    apply(moves)
    expect(order()).toBe('ADBCE')
  })

  it('brings scattered cards together, in the order they had', () => {
    apply(cardMoves(board(), [ids[4], ids[0], ids[2]], ids[3]))
    expect(order()).toBe('BACED')
    freshProject('Story')
    addAsset('long', 120)
    ids = ['A', 'B', 'C', 'D', 'E'].map((name, i) => add('Main', i * 100, (i + 1) * 20, { assetId: 'long', inPoint: i * 300, name }))
    // Cards of different lengths: the moves are still in the right frames.
    apply(cardMoves(board(), [ids[4], ids[1]], ids[0]))
    expect(order()).toBe('BEACD')
    expect(spans('Main').map(([a, b]) => b - a)).toEqual([40, 100, 20, 60, 80])
  })

  it('has nothing to do when the cards are already there', () => {
    expect(cardMoves(board(), [ids[1]], ids[2])).toEqual([])
    expect(cardMoves(board(), [ids[4]], null)).toEqual([])
    expect(cardMoves(board(), [ids[1], ids[2]], ids[2])).toEqual([])
    expect(cardMoves(board(), ['nope'], ids[0])).toEqual([])
  })

  it('takes what is over and under a card with it', () => {
    const title = add('Titles', 310, 50, { kind: 'text', name: 'Over D' })
    apply(cardMoves(board(), [ids[3]], ids[0]))
    expect(order()).toBe('DABCE')
    expect(clip(title).start).toBe(10)
  })
})

describe('reordering sections', () => {
  beforeEach(() => {
    run('marker.add', { frame: 200, kind: 'chapter', label: 'Middle' })
    run('marker.add', { frame: 400, kind: 'chapter', label: 'End' })
  })

  it('moves a whole section, its chapter marker with it', () => {
    const sections = board()
    const move = sectionMove(sections, sections[2].id, sections[0].id)!
    expect(move).toEqual({ start: 400, end: 500, to: 0 })
    apply([move])
    expect(order()).toBe('EABCD')
    expect(board().map((s) => s.title)).toEqual(['End', 'Middle'])
    // What was the opening now follows the first chapter: it belongs to it.
    expect(board()[0].cards.map((c) => clip(c.clipId).name).join('')).toBe('EAB')
  })

  it('moves a section to the end', () => {
    const sections = board()
    apply([sectionMove(sections, sections[1].id, null)!])
    expect(order()).toBe('ABECD')
    expect(getProject().markers.map((m) => [m.label, m.frame])).toEqual([
      ['End', 200],
      ['Middle', 300],
    ])
  })

  it('has nothing to do when the section is already there', () => {
    const sections = board()
    expect(sectionMove(sections, sections[0].id, sections[1].id)).toBeNull()
    expect(sectionMove(sections, sections[2].id, null)).toBeNull()
    expect(sectionMove(sections, sections[1].id, sections[1].id)).toBeNull()
  })
})
