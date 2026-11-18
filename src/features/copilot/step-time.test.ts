import { describe, expect, it, vi } from 'vitest'

// The window speaks Chinese here. Its language is settled as the interface's modules load, from what the user chose.
vi.stubGlobal('localStorage', { getItem: (key: string) => (key === 'lumen.language' ? 'zh-CN' : null), setItem: () => {}, removeItem: () => {} })

const { language } = await import('@/lib/i18n')
const { stepTime } = await import('./transcript')

describe('what a Copilot step says beside its name', () => {
  it('is how long it has been at work, or how long it took', () => {
    expect(stepTime({ status: 'running', startedAt: 1_000 }, 13_400)).toBe('12 s')
    expect(stepTime({ status: 'writing', startedAt: 1_000 }, 1_200)).toBe('0 s')
    expect(stepTime({ status: 'done', startedAt: 1_000, endedAt: 73_000 }, 99_000)).toBe('1 m 12 s')
    expect(stepTime({ status: 'error', startedAt: 1_000, endedAt: 4_000 }, 99_000)).toBe('3 s')
    // Under a second isn't worth saying.
    expect(stepTime({ status: 'done', startedAt: 1_000, endedAt: 1_400 }, 99_000)).toBe('')
  })

  it('says that it was stopped, in the window’s language', () => {
    expect(language).toBe('zh-CN')
    // The word was written as it is, not looked up: a step stopped in a Chinese window said "stopped".
    expect(stepTime({ status: 'stopped', startedAt: 1_000, endedAt: 4_000 }, 99_000)).toBe('已停止')
  })
})
