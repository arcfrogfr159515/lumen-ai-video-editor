import { beforeEach, describe, expect, it, vi } from 'vitest'

const stored = new Map<string, string>()
let prefersLight = false
const root = { dataset: {} as Record<string, string>, classList: { toggle: vi.fn() } }
const told: string[] = []
vi.stubGlobal('localStorage', { getItem: (k: string) => stored.get(k) ?? null, setItem: (k: string, v: string) => void stored.set(k, v), removeItem: (k: string) => void stored.delete(k) })
vi.stubGlobal('matchMedia', () => ({ matches: prefersLight, addEventListener: () => {} }))
vi.stubGlobal('document', { documentElement: root, querySelector: () => null })
vi.mock('./platform', () => ({ desktop: { system: { setTheme: (t: string) => void told.push(t) } } }))

const theme = await import('./theme')

beforeEach(() => {
  stored.clear()
  prefersLight = false
  told.length = 0
  root.dataset = {}
})

describe('the theme', () => {
  it('is dark unless the user says otherwise, whatever the computer is set to', () => {
    prefersLight = true
    expect(theme.themeChoice()).toBe('dark')
    expect(theme.currentTheme()).toBe('dark')
    theme.applyTheme()
    expect(root.dataset.theme).toBe('dark')
    expect(told).toEqual(['dark'])
  })

  it('changes at once when chosen, is remembered, and the window around the page is told', () => {
    theme.chooseTheme('light')
    expect(root.dataset.theme).toBe('light')
    expect(stored.get('lumen.theme')).toBe('light')
    expect(told).toEqual(['light'])
    theme.chooseTheme('dark')
    expect(root.dataset.theme).toBe('dark')
    // Dark is the default: nothing needs to be kept to have it.
    expect(stored.has('lumen.theme')).toBe(false)
  })

  it('follows the computer when asked to', () => {
    theme.chooseTheme('system')
    expect(theme.currentTheme()).toBe('dark')
    prefersLight = true
    expect(theme.currentTheme()).toBe('light')
    theme.applyTheme()
    expect(root.dataset.theme).toBe('light')
  })

  it('takes anything else that was stored for the default', () => {
    stored.set('lumen.theme', 'sepia')
    expect(theme.themeChoice()).toBe('dark')
  })

  it('tells what is painted by hand to paint again', () => {
    const repaint = vi.fn()
    const stop = theme.onThemeChange(repaint)
    theme.chooseTheme('light')
    expect(repaint).toHaveBeenCalledTimes(1)
    stop()
    theme.chooseTheme('dark')
    expect(repaint).toHaveBeenCalledTimes(1)
  })
})
