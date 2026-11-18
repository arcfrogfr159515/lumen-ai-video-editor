/**
 * The editor's page going away — closed, reloaded, or its process dead — as the work done for it in this process
 * hears of it. What the page had asked for goes with it: its answers have nowhere to arrive, and the page that
 * comes next knows nothing of them. Whoever watches the window says when (editor-rpc); what has to end then says
 * so here.
 */
const listeners = new Set<() => void>()

/** Calls back each time the editor's page goes away. Returns a function that stops it being called. */
export function onEditorGone(fn: () => void) {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}

/** The editor's page went away. */
export function editorGone() {
  for (const fn of [...listeners]) {
    try {
      fn()
    } catch (err) {
      // One that fails doesn't keep the rest from ending.
      console.warn('Something the editor’s page had started couldn’t be ended.', err)
    }
  }
}
