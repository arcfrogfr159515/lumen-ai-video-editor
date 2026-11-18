import { beforeEach, describe, expect, it, vi } from 'vitest'

// The window speaks Chinese here.
vi.stubGlobal('localStorage', { getItem: (key: string) => (key === 'lumen.language' ? 'zh-CN' : null), setItem: () => {}, removeItem: () => {} })

const { language } = await import('@/lib/i18n')
const { addAsset, freshProject, run } = await import('./test-helpers')
const { getProject } = await import('./store')
const { allSequences } = await import('./sequences')

let main = ''
beforeEach(() => {
  freshProject('旅行短片')
  addAsset('footage', 60)
  addAsset('second', 60)
  main = getProject().tracks.find((t) => t.role === 'main')!.id
})

/** The names of the project's timelines other than the one it began with. */
const others = () =>
  allSequences(getProject())
    .map((s) => s.name)
    .filter((name) => name !== '主时间线')

describe('what a timeline made without a name is called, in a Chinese window', () => {
  it('names a new timeline in Chinese, and the next one after it', () => {
    expect(language).toBe('zh-CN')
    // “Timeline”, “Timeline 2”: the name was written as it is, while the first timeline is “主时间线” and a copy “… 副本”.
    run('sequence.create', { open: false })
    run('sequence.create', { open: false })
    expect(others().sort()).toEqual(['时间线', '时间线 2'])
  })

  it('names what clips are nested into in Chinese — the timeline, and the clip that plays it', () => {
    const clip = run('clip.add', { trackId: main, kind: 'video', start: 0, duration: 30, assetId: 'footage' }) as string
    const { clipId } = run('clip.nest', { ids: [clip] }) as { clipId: string }
    expect(others()).toEqual(['嵌套'])
    expect(getProject().clips[clipId].name).toBe('嵌套')
  })

  it('names a multicam timeline in Chinese', () => {
    run('multicam.create', { angles: [{ assetId: 'footage', offset: 0 }, { assetId: 'second', offset: 0 }], audio: 0, place: false, start: 0 })
    expect(others()).toEqual(['多机位'])
  })
})
