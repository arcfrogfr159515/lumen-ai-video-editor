/** One audio preview at a time, straight from the file, at the preview volume. */
import { monitorLevel, onMonitorChange } from '@/editor/playback'
import { useEditor } from '@/editor/store'

let el: HTMLAudioElement | null = null
const listeners = new Set<() => void>()
const changed = () => listeners.forEach((f) => f())

onMonitorChange((gain) => {
  if (el) el.volume = gain
})

// A preview stops when its media leaves the project — removed, or another project opened. Its row goes with it,
// and the button on the row was the only thing that could stop it: it played on to its end, however long.
useEditor.subscribe((s, prev) => {
  if (!el || el.paused || s.project.assets === prev.project.assets) return
  const url = el.dataset.url
  if (!Object.values(s.project.assets).some((a) => a.source.type === 'file' && a.source.url === url)) el.pause()
})

/** Whether the file at `url` is the one being played. */
export const previewing = (url: string | undefined) => Boolean(url && el && !el.paused && el.dataset.url === url)

/** Called whenever a preview starts, pauses or ends. Returns how to stop listening. */
export function onPreviewChange(fn: () => void) {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}

/** Plays the file at `url` — or pauses it, when it is the one playing. */
export function togglePreview(url: string) {
  if (previewing(url)) return void el!.pause()
  el?.pause()
  el = new Audio(url)
  el.dataset.url = url
  el.crossOrigin = 'anonymous'
  el.volume = monitorLevel()
  el.onpause = el.onended = el.onplay = changed
  void el.play()
}
