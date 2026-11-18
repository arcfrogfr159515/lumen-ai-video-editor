import { beforeEach, describe, expect, it, vi } from 'vitest'

// The window speaks Chinese here. Its language is settled as the interface's modules load, from what the user chose.
vi.stubGlobal('localStorage', { getItem: (key: string) => (key === 'lumen.language' ? 'zh-CN' : null), setItem: () => {}, removeItem: () => {} })

const { language } = await import('@/lib/i18n')
const { addAsset, freshProject, run } = await import('./test-helpers')
const { getProject, useEditor } = await import('./store')
const { propName } = await import('./commands')
const { ANIMATABLE } = await import('./keyframes')

/** What the History — and Undo, in the title bar — calls the last edit. */
const lastStep = () => useEditor.getState().past.at(-1)?.label

let main = ''
/** A clip of the test's footage on the main track. */
const clip = (start: number, duration = 30) => run('clip.add', { trackId: main, kind: 'video', start, duration, assetId: 'footage' }) as string

beforeEach(() => {
  freshProject('旅行短片')
  addAsset('footage', 60)
  main = getProject().tracks.find((t) => t.role === 'main')!.id
})

describe('what the History calls an edit, in a Chinese window', () => {
  it('is Chinese', () => {
    expect(language).toBe('zh-CN')
    clip(0)
    expect(lastStep()).toBe('添加片段')
  })

  it('says a delete in one language', () => {
    // What was deleted was looked up and the verb was not: "Delete 片段", "Ripple delete 2 个片段".
    const [a, b, c] = [clip(0), clip(30), clip(60)]
    run('clip.delete', { ids: [a] })
    expect(lastStep()).toBe('删除 片段')
    run('clip.delete', { ids: [b, c], ripple: true })
    expect(lastStep()).toBe('波纹删除 2 个片段')
  })

  it('says a trim in Chinese, whichever edge and whichever way', () => {
    // "Trim start", "Ripple trim end": the name was put together from English words as they are written.
    const overlay = getProject().tracks.find((t) => t.kind === 'video' && !t.role)!.id
    const id = run('clip.add', { trackId: overlay, kind: 'video', start: 30, duration: 60, assetId: 'footage', inPoint: 30 }) as string
    run('clip.trim', { id, edge: 'end', frame: 80 })
    expect(lastStep()).toBe('修剪结尾')
    run('clip.trim', { id, edge: 'start', frame: 40 })
    expect(lastStep()).toBe('修剪开头')
    run('clip.trim', { id, edge: 'end', frame: 70, ripple: true })
    expect(lastStep()).toBe('波纹修剪结尾')
    run('clip.trim', { id, edge: 'start', frame: 50, ripple: true })
    expect(lastStep()).toBe('波纹修剪开头')
  })

  it('says which kind of track was added in Chinese', () => {
    // "添加 video 轨道": the kind went into the sentence as the code writes it.
    run('track.add', { kind: 'video' })
    expect(lastStep()).toBe('添加视频轨道')
    run('track.add', { kind: 'audio' })
    expect(lastStep()).toBe('添加音频轨道')
  })

  it('names the property a keyframe is on in Chinese', () => {
    // "关键帧：scale", "移除 scale 关键帧", "清除 x 动画": the property went in as the code writes it.
    const id = clip(0, 60)
    run('keyframe.set', { clipId: id, prop: 'scale', frame: 0, value: 1 })
    expect(lastStep()).toBe('关键帧：缩放')
    run('keyframe.set', { clipId: id, prop: 'x', frame: 0, value: 10 })
    expect(lastStep()).toBe('关键帧：水平位置')
    run('keyframe.set', { clipId: id, prop: 'rotateY', frame: 0, value: 10 })
    expect(lastStep()).toBe('关键帧：Y 轴转动')
    run('keyframe.remove', { clipId: id, prop: 'scale', frame: 0 })
    expect(lastStep()).toBe('移除缩放关键帧')
    run('keyframe.clear', { clipId: id, prop: 'x' })
    expect(lastStep()).toBe('清除水平位置动画')
    // Every property that can be animated has a word: none is left as the code writes it (the Inspector's list of keyframes names them the same way).
    expect(ANIMATABLE.map(propName)).toEqual(['水平位置', '垂直位置', '缩放', '旋转', '不透明度', '音量', 'X 轴倾斜', 'Y 轴转动', '深度', '速度'])
  })

  it('says a change in the mixer in Chinese, and whose it is', () => {
    // "Volume · master", "Edit EQ · 人声": what was changed was English words as written, and so was the master's name.
    const voice = getProject().tracks.find((t) => t.kind === 'audio')!
    run('mix.update', { target: voice.id, patch: { volume: -6 } })
    expect(lastStep()).toBe(`音量 · ${voice.name}`)
    run('mix.update', { target: voice.id, patch: { pan: 0.2 } })
    expect(lastStep()).toBe(`声像 · ${voice.name}`)
    run('mix.update', { target: voice.id, patch: { eq: { lowCut: 80 } } })
    expect(lastStep()).toBe(`编辑均衡器 · ${voice.name}`)
    run('mix.update', { target: 'master', patch: { compressor: { threshold: -20 } } })
    expect(lastStep()).toBe('编辑压缩器 · 母版')
    run('mix.update', { target: 'master', patch: { limiter: { ceiling: -2 } } })
    expect(lastStep()).toBe('编辑限制器 · 母版')
  })
})
