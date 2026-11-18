import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('sonner', () => ({ toast: Object.assign(() => {}, { error: () => {}, success: () => {} }) }))
// No model here: the subject's matte is one the test has put in the project.
vi.mock('./segment', () => ({ subjectMatte: async () => ({ assetId: 'matte', from: 0 }) }))

const { addAsset, freshProject, run } = await import('@/editor/test-helpers')
const { getProject, useEditor } = await import('@/editor/store')
const { textBehindSubject } = await import('./subject')

const track = (name: string) => getProject().tracks.find((t) => t.name === name)!.id
const footage = (on: string, start: number, duration: number) => run('clip.add', { trackId: track(on), kind: 'video', start, duration, assetId: 'footage' }) as string
const title = (start: number, duration: number, words: string) => run('clip.add', { trackId: track('Titles'), kind: 'text', start, duration, name: words, patch: { text: { content: words } } }) as string
/** The timeline as it reads top down: each track's name and what is on it. */
const timeline = () => {
  const p = getProject()
  return p.tracks
    .filter((t) => t.kind === 'video')
    .map((t) => {
      const on = Object.values(p.clips)
        .filter((c) => c.trackId === t.id)
        .sort((a, b) => a.start - b.start)
        .map((c) => `${c.kind === 'text' ? c.text?.content : c.name} ${c.start}–${c.start + c.duration}`)
      return `${t.name}: ${on.join(', ')}`
    })
}

beforeEach(() => {
  freshProject('Trip')
  addAsset('footage', 20)
  addAsset('matte', 20, 'video', { matteOf: { assetId: 'footage', subject: 'person', from: 0, to: 600 } })
})

describe('the title that goes behind the subject', () => {
  it('lies over the whole clip on the track titles go to, when that is free there', async () => {
    const clip = footage('Main', 0, 150)
    await textBehindSubject(clip, { text: 'HELLO' })
    expect(timeline()).toEqual(['Subject: footage — subject 0–150', 'Titles: HELLO 0–150', 'Overlay: ', 'Main: footage 0–150'])
  })

  it('lies over the whole clip when another title is there already', async () => {
    // The track titles go to had a title over this clip. The new one was added to it all the same, slid off to
    // the nearest free place — after the other title, past the end of the clip — and was cut to a single frame
    // there: no text behind anything, and the action said it went well.
    const clip = footage('Main', 0, 150)
    title(0, 150, 'Intro')
    const { titleClipId, subjectClipId } = await textBehindSubject(clip, { text: 'HELLO' })
    // A track of its own right over the footage; the title that was there stays on top of it all.
    expect(timeline()).toEqual(['Titles: Intro 0–150', 'Overlay: ', 'Subject: footage — subject 0–150', 'Titles: HELLO 0–150', 'Main: footage 0–150'])
    expect(getProject().clips[titleClipId]).toMatchObject({ start: 0, duration: 150 })
    expect(getProject().clips[subjectClipId]).toMatchObject({ start: 0, duration: 150, matte: { assetId: 'matte', from: 0 } })
    // One undo step takes all of it back.
    useEditor.getState().undo()
    expect(timeline()).toEqual(['Titles: Intro 0–150', 'Overlay: ', 'Main: footage 0–150'])
  })

  it('lies over the whole clip when another title begins part-way through it', async () => {
    // Free where the clip begins, but not to its end: the title stopped where the other one starts.
    const clip = footage('Main', 0, 300)
    title(200, 60, 'Outro')
    await textBehindSubject(clip, { text: 'HELLO' })
    expect(timeline()).toEqual(['Titles: Outro 200–260', 'Overlay: ', 'Subject: footage — subject 0–300', 'Titles: HELLO 0–300', 'Main: footage 0–300'])
  })

  it('lies over the whole clip when the clip itself is on the track titles go to', async () => {
    const clip = footage('Titles', 60, 90)
    await textBehindSubject(clip, { text: 'HELLO' })
    expect(timeline()).toEqual(['Subject: footage — subject 60–150', 'Titles: HELLO 60–150', 'Titles: footage 60–150', 'Overlay: ', 'Main: '])
  })
})
