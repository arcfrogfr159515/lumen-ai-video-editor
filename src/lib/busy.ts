/**
 * What the editor is in the middle of that closing Lumen would cut short: an export, the render queue, a
 * recording. Each says so while it runs, and the session passes it on to the main process, which asks before
 * the window is closed. (It asked only about unsaved changes: with a saved project, a click on the window's
 * corner ended an hour's export without a word.)
 */

const running = new Map<string, string>()
const listeners = new Set<() => void>()

/** Says that `what` is running, in words for the user (`label`), or — with null — that it no longer is. */
export function setBusy(what: string, label: string | null) {
  if (label === null ? !running.delete(what) : running.get(what) === label) return
  if (label !== null) running.set(what, label)
  for (const fn of listeners) fn()
}

/** What is running now, in the user's words. */
export const busyWith = (): string[] => [...running.values()]

/** Calls back whenever something starts or ends. Returns the way to stop. */
export function onBusyChange(fn: () => void) {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}
