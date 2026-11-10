import { beforeEach, describe, expect, it } from 'vitest'
import { followsRipple } from './ops'
import { getProject } from './store'
import { add, addAsset, freshProject, onTrack, refusal, run, spans, trackId } from './test-helpers'

beforeEach(() => {
  freshProject('Locks')
  addAsset('long', 60)
  addAsset('song', 120, 'audio')
})

const track = (name: string) => getProject().tracks.find((t) => t.name === name)!

describe('sync lock', () => {
  it('is on unless a track says otherwise, and is stored only when off', () => {
    expect(followsRipple(track('Music'))).toBe(true)
    run('track.update', { id: trackId('Music'), patch: { syncLock: false } })
    expect(track('Music').syncLock).toBe(false)
    expect(followsRipple(track('Music'))).toBe(false)
    run('track.update', { id: trackId('Music'), patch: { syncLock: true } })
    expect('syncLock' in track('Music')).toBe(false)
  })

  it('leaves a track out of an edit that ripples the timeline', () => {
    add('Main', 0, 300, { assetId: 'long' })
    add('Overlay', 200, 60, { assetId: 'long' })
    add('Music', 150, 100, { assetId: 'song' })
    run('track.update', { id: trackId('Music'), patch: { syncLock: false } })
    run('timeline.removeRange', { start: 60, end: 120 })
    // The picture closes up and the overlay follows it; the music stays where it was.
    expect(spans('Main')).toEqual([
      [0, 60],
      [60, 240],
    ])
    expect(spans('Overlay')).toEqual([[140, 200]])
    expect(spans('Music')).toEqual([[150, 250]])
  })

  it('does not cut a clip that lies across the removed stretch on a track out of sync', () => {
    add('Main', 0, 300, { assetId: 'long' })
    add('Music', 0, 300, { assetId: 'song' })
    run('track.update', { id: trackId('Music'), patch: { syncLock: false } })
    run('timeline.removeRange', { start: 100, end: 200 })
    expect(spans('Music')).toEqual([[0, 300]])
  })
})

describe('ripple lock', () => {
  beforeEach(() => {
    add('Music', 0, 100, { assetId: 'song' })
    add('Music', 100, 100, { assetId: 'song', inPoint: 100 })
    add('Music', 200, 100, { assetId: 'song', inPoint: 200 })
    run('track.update', { id: trackId('Music'), patch: { rippleLock: true } })
  })

  it('keeps the gap a ripple delete would close', () => {
    run('clip.delete', { ids: [onTrack('Music')[1].id], ripple: true })
    expect(spans('Music')).toEqual([
      [0, 100],
      [200, 300],
    ])
  })

  it('turns a ripple trim into a plain trim', () => {
    run('clip.trim', { id: onTrack('Music')[0].id, edge: 'end', frame: 60, ripple: true })
    expect(spans('Music')).toEqual([
      [0, 60],
      [100, 200],
      [200, 300],
    ])
  })

  it('stays put when a stretch is taken out of the timeline', () => {
    add('Main', 0, 300, { assetId: 'long' })
    run('timeline.removeRange', { start: 0, end: 50 })
    expect(spans('Main')).toEqual([[0, 250]])
    expect(spans('Music')).toEqual([
      [0, 100],
      [100, 200],
      [200, 300],
    ])
  })

  it('refuses inserts, saying what to do instead', () => {
    const error = refusal('clip.add', { trackId: trackId('Music'), kind: 'audio', start: 50, duration: 30, assetId: 'song', mode: 'insert' })
    expect(error).toMatch(/ripple-locked/)
    expect(error).toMatch(/Overwrite/)
    // Overwriting is still fine: nothing has to move.
    run('clip.add', { trackId: trackId('Music'), kind: 'audio', start: 50, duration: 30, assetId: 'song', mode: 'overwrite' })
    expect(spans('Music')).toEqual([
      [0, 50],
      [50, 80],
      [80, 100],
      [100, 200],
      [200, 300],
    ])
  })

  it('is refused on the main track, which always closes its gaps', () => {
    expect(refusal('track.update', { id: trackId('Main'), patch: { rippleLock: true } })).toMatch(/main track/)
  })

  it('comes off again, leaving nothing behind in the project', () => {
    run('track.update', { id: trackId('Music'), patch: { rippleLock: false } })
    expect('rippleLock' in track('Music')).toBe(false)
  })
})
