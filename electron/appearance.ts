/**
 * The part of the theme that is outside the page: the window's background while the page loads, the caption
 * buttons Windows draws over the title bar, and what the system's own menus and dialogs look like. The window
 * says which theme it is in; it is remembered so the next start opens in it from the first frame.
 */
import { BrowserWindow, nativeTheme } from 'electron'
import { readJson, writeJson } from './integrations/paths'

export type Theme = 'dark' | 'light'
const FILE = 'appearance.json'
/** The canvas colour of each theme (src/styles/index.css), and the caption buttons' glyphs on it. */
const LOOK: Record<Theme, { canvas: string; symbol: string }> = {
  dark: { canvas: '#080807', symbol: '#a2a39b' },
  light: { canvas: '#e7e7e1', symbol: '#3f4038' },
}

let current: Theme | null = null

export function theme(): Theme {
  if (current) return current
  try {
    return (current = readJson<{ theme?: string }>(FILE, {}).theme === 'light' ? 'light' : 'dark')
  } catch {
    return 'dark'
  }
}

export const windowLook = () => LOOK[theme()]

export function setTheme(next: unknown) {
  if (next !== 'dark' && next !== 'light') return
  const changed = next !== theme()
  current = next
  nativeTheme.themeSource = next
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    win.setBackgroundColor(LOOK[next].canvas)
    // Only where the system draws caption buttons over the page (not on macOS).
    if (process.platform !== 'darwin') {
      try {
        win.setTitleBarOverlay({ color: LOOK[next].canvas, symbolColor: LOOK[next].symbol })
      } catch {
        // A window without an overlay (an offscreen one) has nothing to recolour.
      }
    }
  }
  if (!changed) return
  try {
    writeJson(FILE, { theme: next })
  } catch {
    // It is still used until Lumen closes.
  }
}
