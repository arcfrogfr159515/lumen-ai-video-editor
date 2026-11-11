/**
 * Dark or light. Dark is what Lumen has always been and stays the default; light is the same interface on paper.
 * The choice is the user's — a theme, or whatever the computer is set to — and takes effect at once: every colour
 * the interface is drawn in is a token (src/styles/index.css), and a theme is a set of values for them.
 */
import { desktop } from './platform'

export type Theme = 'dark' | 'light'
export type ThemeChoice = Theme | 'system'

const STORE = 'lumen.theme'
const listeners = new Set<() => void>()

export function themeChoice(): ThemeChoice {
  try {
    const stored = localStorage.getItem(STORE)
    return stored === 'light' || stored === 'system' ? stored : 'dark'
  } catch {
    return 'dark'
  }
}

const systemTheme = (): Theme => (typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')

/** The theme on screen now. */
export const currentTheme = (): Theme => {
  const choice = themeChoice()
  return choice === 'system' ? systemTheme() : choice
}

/** Puts the theme on the page, and tells the window around it (its caption buttons and background follow). */
export function applyTheme() {
  if (typeof document === 'undefined') return
  const theme = currentTheme()
  const root = document.documentElement
  root.dataset.theme = theme
  root.classList.toggle('dark', theme === 'dark')
  document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', theme)
  desktop?.system.setTheme?.(theme)
  for (const fn of listeners) fn()
}

export function chooseTheme(choice: ThemeChoice) {
  try {
    if (choice === 'dark') localStorage.removeItem(STORE)
    else localStorage.setItem(STORE, choice)
  } catch {
    // It still shows until the window closes.
  }
  applyTheme()
}

/** For what is painted by hand (the ruler, waveforms) and has to be painted again in the new colours. */
export function onThemeChange(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** A token's colour as the page has it now — for a canvas, which can't be given `var(--color-…)`. */
export function tokenColor(name: string, fallback = '#888888'): string {
  if (typeof document === 'undefined') return fallback
  return getComputedStyle(document.documentElement).getPropertyValue(`--color-${name}`).trim() || fallback
}

if (typeof window !== 'undefined' && typeof matchMedia === 'function') {
  // The computer changes its mind (at dusk, say): follow, if that is what was asked for.
  matchMedia('(prefers-color-scheme: light)').addEventListener?.('change', () => themeChoice() === 'system' && applyTheme())
}
