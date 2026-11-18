import { describe, expect, it, vi } from 'vitest'

// Pictures need a real canvas; a cell's label doesn't.
vi.mock('@/engine/stills', () => ({ timelineStills: async () => [], mediaStills: async () => [], contactSheet: () => ({ width: 1, height: 1 }), canvasBase64: () => '' }))

const { label } = await import('./vision')

describe('the time on a contact sheet’s cell', () => {
  it('is minutes, seconds and tenths', () => {
    expect(label(0)).toBe('0:00.0')
    expect(label(5)).toBe('0:05.0')
    expect(label(12.5)).toBe('0:12.5')
    expect(label(75.24)).toBe('1:15.2')
    expect(label(3725)).toBe('62:05.0')
  })

  it('turns the minute over when the tenths round up to it', () => {
    // 59.96 s is a minute to the nearest tenth: it used to read “0:60.0”.
    expect(label(59.96)).toBe('1:00.0')
    expect(label(119.97)).toBe('2:00.0')
    expect(label(59.94)).toBe('0:59.9')
  })
})
