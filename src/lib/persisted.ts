/**
 * Settings kept between sessions come back from local storage as whatever was
 * left there: by this version, by an older or a newer one, or by a profile
 * that was damaged. One value of the wrong kind — a list that is now a word,
 * a tab that no longer exists — and a panel throws every time the editor
 * starts, with nothing the user can do about it. So each value is taken only
 * if it is the kind of thing the editor has now; anything else keeps its
 * default. A setting may be forgotten; the editor must start.
 *
 * (The stored state carries no version number of its own on purpose: a build
 * that doesn't know the number throws the whole state away, so going back to
 * an older Lumen would lose it.)
 */

import { toast } from 'sonner'
import { createJSONStorage } from 'zustand/middleware'
import { tt } from '@/lib/i18n'

/**
 * Local storage for a store kept between sessions, that says so instead of
 * throwing when it can't be written (it is full, or the profile is read-only).
 * A store writes itself at every change: left to throw, a full storage turns
 * every click that changes a setting — and, while a macro is being recorded,
 * every edit — into an error, after the change has already been made.
 */
export function quietStorage<S>(what: 'settings' | 'macros' = 'settings') {
  let failing = false
  return createJSONStorage<S>(() => {
    // Where there is no storage at all this throws, and the store simply isn't kept (as before).
    const inner = window.localStorage
    return {
      getItem: (name) => inner.getItem(name),
      removeItem: (name) => inner.removeItem(name),
      setItem: (name, value) => {
        try {
          inner.setItem(name, value)
          failing = false
        } catch (err) {
          // Said once for a run of failures, not at every change.
          if (failing) return
          failing = true
          console.warn(`${name} couldn’t be saved`, err)
          if (what === 'macros') toast.warning(tt('Your macros couldn’t be saved'), { description: tt('Lumen’s storage for settings on this computer is full. They work until Lumen is closed — export them from the Macros dialog to keep them.'), duration: 12000 })
          else toast.warning(tt('Your settings couldn’t be saved'), { description: tt('Lumen’s storage for settings on this computer is full. They’ll be as they were the next time Lumen opens.'), duration: 12000 })
        }
      },
    }
  })
}

/** Reads one stored value: the value to use, or undefined to keep the default. */
export type Read<T> = (value: unknown) => T | undefined

export const flag: Read<boolean> = (v) => (typeof v === 'boolean' ? v : undefined)

/** One of the values there are. */
export const choice =
  <const T extends readonly (string | number)[]>(...values: T): Read<T[number]> =>
  (v) =>
    values.includes(v as never) ? (v as T[number]) : undefined

/** A number, brought back inside the range it can have. */
export const between =
  (min: number, max: number): Read<number> =>
  (v) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : undefined

/** A list, without the entries that can't be read. */
export const each =
  <T>(item: Read<T>): Read<T[]> =>
  (v) =>
    Array.isArray(v)
      ? v.flatMap((x) => {
          const read = item(x)
          return read === undefined ? [] : [read]
        })
      : undefined

/** For zustand's `persist`: merges what was stored into the state, value by value, through its reader. */
export function kept<P extends object>(reads: { [K in keyof P]-?: Read<P[K]> }) {
  return <S extends object>(persisted: unknown, current: S): S => {
    const taken: Record<string, unknown> = {}
    if (persisted && typeof persisted === 'object') {
      for (const [key, read] of Object.entries(reads) as [string, Read<unknown>][]) {
        const value = read((persisted as Record<string, unknown>)[key])
        if (value !== undefined) taken[key] = value
      }
    }
    return { ...current, ...taken }
  }
}
