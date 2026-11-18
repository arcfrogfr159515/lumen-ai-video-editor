import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { INGEST_QUALITIES, type IngestQuality, type IngestState } from '@shared/ingest'

// A window in Chinese.
vi.stubGlobal('localStorage', { getItem: (key: string) => (key === 'lumen.language' ? 'zh-CN' : null), setItem: () => {}, removeItem: () => {} })
vi.stubGlobal('requestAnimationFrame', () => 0)
vi.stubGlobal('cancelAnimationFrame', () => {})
vi.mock('sonner', () => ({ toast: Object.assign(() => {}, { error: () => {}, success: () => {}, loading: () => 1, dismiss: () => {} }) }))
// Drawn without a browser, a component reads a store as it was first made; here a store's hook reads it as it is.
vi.mock('zustand', async (original) => {
  const actual = await original<typeof import('zustand')>()
  const { createStore } = await import('zustand/vanilla')
  type Init = import('zustand/vanilla').StateCreator<unknown>
  const make = (init: Init) => {
    const store = createStore<unknown>(init)
    return Object.assign((selector?: (state: unknown) => unknown) => (selector ? selector(store.getState()) : store.getState()), store)
  }
  return { ...actual, create: (init?: Init) => (init ? make(init) : make) }
})

const { language } = await import('@/lib/i18n')
const { useIngest } = await import('@/project/ingest')
const { IngestPane } = await import('./IngestPane')

/** The words of the frame ingest pane, with a quality chosen. */
function shown(quality: IngestQuality) {
  const state: IngestState = { running: false, port: 47920, token: 'secret', quality, folder: 'C:\\ingest', clips: [] }
  useIngest.setState({ state })
  return renderToString(createElement(IngestPane))
    .replace(/<[^>]*>/g, '\n')
    .replace(/&amp;/g, '&')
}

describe('how hard frame ingest compresses, in a window in Chinese', () => {
  it('names the three choices, and says what the chosen one costs, in Chinese', () => {
    expect(language).toBe('zh-CN')
    // The list is shared with the main process and written in English: “Master”, “Lossless”, “Compact”, and under
    // them “Visually lossless — about 0.5 MB a frame at 1440p”.
    for (const quality of INGEST_QUALITIES) {
      const words = shown(quality.id)
      for (const other of INGEST_QUALITIES) expect(words.split('\n'), `${quality.id}: ${other.name}`).not.toContain(other.name)
      expect(words, quality.id).not.toContain(quality.hint)
    }
    expect(shown('master')).toContain('视觉无损——1440p 下每帧约 0.5 MB')
    expect(shown('lossless')).toContain('每个像素都与发送时完全一致——1440p 下每帧约 3 MB，播放较慢')
    expect(shown('compact')).toContain('高质量、小文件——1440p 下每帧约 0.25 MB')
    expect(shown('master').split('\n')).toEqual(expect.arrayContaining(['母版', '无损', '紧凑']))
  })
})
