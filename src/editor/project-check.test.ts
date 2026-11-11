import { beforeEach, describe, expect, it } from 'vitest'
import { projectDuration } from './ops'
import { checkProject, ProjectError } from './project-check'
import { dispatch, getProject, migrateProject, useEditor } from './store'
import { add, addAsset, freshProject, run } from './test-helpers'

/** A project as a file holds it: a few clips on a few tracks, a marker, a second timeline with the first nested in it. */
function saved() {
  freshProject('Film')
  addAsset('shot', 60)
  add('Overlay', 0, 90, { assetId: 'shot', name: 'A' })
  add('Overlay', 120, 60, { assetId: 'shot', name: 'B' })
  run('marker.add', { frame: 45, label: 'Chapter' })
  return JSON.parse(JSON.stringify(getProject())) as Record<string, any>
}
const firstClip = (p: Record<string, any>) => Object.keys(p.clips)[0]
/** Opens it the way the editor does, and says what the editor is left with. */
function open(p: Record<string, any>) {
  const { project, repairs } = checkProject(p)
  useEditor.getState().loadProject(migrateProject(project))
  const now = getProject()
  return { repairs, clips: Object.keys(now.clips).length, markers: now.markers.length, settings: now.settings, duration: projectDuration(now), edit: dispatch('marker.add', { frame: 5 }).ok }
}

beforeEach(() => freshProject('Other'))

describe('opening a project', () => {
  it('opens a sound one untouched', () => {
    const p = saved()
    const text = JSON.stringify(p)
    const { project, repairs } = checkProject(p)
    expect(repairs).toEqual([])
    expect(JSON.stringify(project)).toBe(text)
    expect(open(saved())).toMatchObject({ clips: 2, markers: 1, duration: 180, edit: true })
  })

  it('opens projects from before clips, media and markers were always written', () => {
    const p = saved()
    delete p.clips
    delete p.assets
    delete p.markers
    delete p.sequences
    expect(open(p)).toMatchObject({ repairs: [], clips: 0, markers: 0, edit: true })
  })

  it('refuses what isn’t a project, saying why', () => {
    const cases: [string, (p: Record<string, any>) => unknown, RegExp][] = [
      ['a list', () => [], /doesn’t hold a project/],
      ['a word', () => 'project', /doesn’t hold a project/],
      ['nothing', () => null, /doesn’t hold a project/],
      ['tracks is null', (p) => ((p.tracks = null), p), /no list of tracks/],
      ['tracks missing', (p) => (delete p.tracks, p), /no list of tracks/],
      ['clips is a list', (p) => ((p.clips = []), p), /clips aren’t in a form/],
      ['markers is an object', (p) => ((p.markers = { a: 1 }), p), /markers aren’t in a form/],
      ['media is a list', (p) => ((p.assets = []), p), /media list isn’t in a form/],
      ['timelines is a word', (p) => ((p.sequences = 'x'), p), /other timelines aren’t in a form/],
    ]
    for (const [label, damage, why] of cases) {
      expect(() => checkProject(damage(saved())), label).toThrow(ProjectError)
      expect(() => checkProject(damage(saved())), label).toThrow(why)
    }
    // Nothing of the open project is given up for a file that is refused.
    expect(getProject().name).toBe('Film')
  })

  it('repairs what is wrong inside a project, and says what it did', () => {
    const cases: [string, (p: Record<string, any>) => void, RegExp, Partial<ReturnType<typeof open>>][] = [
      ['no settings', (p) => delete p.settings, /had no settings: it is 1920×1080 at 30 fps/, { clips: 2, settings: { width: 1920, height: 1080, fps: 30, background: '#000000' } }],
      ['fps 0', (p) => (p.settings.fps = 0), /frame rate couldn’t be read: it is 30 fps/, { clips: 2 }],
      ['fps a word', (p) => (p.settings.fps = '30'), /frame rate couldn’t be read/, { clips: 2 }],
      ['fps not a number', (p) => (p.settings.fps = null), /frame rate couldn’t be read/, { clips: 2 }],
      ['a billion wide', (p) => (p.settings.width = 1e9), /width couldn’t be used: it is 1920 px/, { clips: 2 }],
      ['no height', (p) => delete p.settings.height, /height couldn’t be used: it is 1080 px/, { clips: 2 }],
      ['a length that is a word', (p) => (p.clips[firstClip(p)].duration = 'long'), /1 clip in the timeline couldn’t be read and was left out/, { clips: 1 }],
      ['a length below nothing', (p) => (p.clips[firstClip(p)].duration = -50), /1 clip .* left out/, { clips: 1 }],
      ['a start that isn’t a number', (p) => (p.clips[firstClip(p)].start = null), /1 clip .* left out/, { clips: 1 }],
      ['a track that isn’t there', (p) => (p.clips[firstClip(p)].trackId = 'track_nope'), /1 clip .* left out/, { clips: 1 }],
      ['media that isn’t there', (p) => (p.clips[firstClip(p)].assetId = 'asset_nope'), /1 clip .* left out/, { clips: 1 }],
      ['a nest of a timeline that isn’t there', (p) => (p.clips[firstClip(p)].sequenceId = 'seq_nope'), /1 clip .* left out/, { clips: 1 }],
      ['both clips unreadable', (p) => Object.values<any>(p.clips).forEach((c) => (c.duration = NaN)), /2 clips in the timeline couldn’t be read and were left out/, { clips: 0 }],
      ['a marker with no place', (p) => p.markers.push({ id: 'm9', label: 'Lost' }), /1 marker in the timeline couldn’t be read and was left out/, { markers: 1 }],
      ['no id', (p) => delete p.id, /had no id/, { clips: 2 }],
    ]
    for (const [label, damage, said, left] of cases) {
      const p = saved()
      damage(p)
      const got = open(p)
      expect(got.repairs.join(' | '), label).toMatch(said)
      expect(got, label).toMatchObject(left)
      // Whatever was wrong, what is open now is a project the editor can work on.
      expect(Number.isFinite(got.duration), label).toBe(true)
      expect(got.edit, label).toBe(true)
    }
  })

  it('keeps a clip that nests the open timeline, inside a timeline that isn’t open', () => {
    const p = saved()
    const track = p.tracks[0].id
    p.sequence = { id: 'seq_main', name: 'Main' }
    p.sequences = { seq_b: { id: 'seq_b', name: 'B-roll', settings: { ...p.settings }, tracks: [{ ...p.tracks[0] }], markers: [], createdAt: 0, clips: { c1: { id: 'c1', kind: 'video', trackId: track, name: 'Main, nested', start: 0, duration: 30, inPoint: 0, sequenceId: 'seq_main' }, c2: { id: 'c2', kind: 'video', trackId: track, name: 'Gone', start: 40, duration: 30, inPoint: 0, sequenceId: 'seq_gone' } } } }
    const { project, repairs } = checkProject(p)
    expect(Object.keys(project.sequences!.seq_b.clips)).toEqual(['c1'])
    expect(repairs).toEqual(['1 clip in the timeline “B-roll” couldn’t be read and was left out'])
  })
})
