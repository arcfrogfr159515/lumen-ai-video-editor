import { describe, expect, it, vi } from 'vitest'

// The window is a stand-in that keeps what it was made with.
const made = vi.hoisted(() => [] as { show?: boolean; width?: number; height?: number; webPreferences?: Record<string, unknown> }[])
vi.mock('electron', () => ({
  BrowserWindow: class {
    constructor(options: (typeof made)[number]) {
      made.push(options)
    }
    setContentSize() {}
  },
  screen: { getAllDisplays: () => [{ workAreaSize: { width: 1536, height: 824 } }] },
}))

const { exactOffscreenWindow, renderScale } = await import('./offscreen')

describe('a window nobody sees', () => {
  it('renders at the size asked for, however the display is scaled', () => {
    expect(renderScale(1280, 720)).toBe(1)
    expect(renderScale(1920, 1080)).toBe(2)
    const { k } = exactOffscreenWindow(1920, 1080, { webPreferences: { sandbox: true } })
    expect(k).toBe(2)
    expect(made.at(-1)).toMatchObject({ show: false, width: 960, height: 540, webPreferences: { sandbox: true, zoomFactor: 0.5, offscreen: { deviceScaleFactor: 2 } } })
  })

  it('shows none of its page’s dialogs, whatever it is made with', () => {
    // A page's alert() from a hidden window is a box on the user's screen that holds the page until it is clicked.
    for (const webPreferences of [undefined, { sandbox: true }, { disableDialogs: false, safeDialogs: true }]) {
      exactOffscreenWindow(640, 360, { webPreferences })
      expect(made.at(-1)!.webPreferences!.disableDialogs).toBe(true)
    }
  })
})
