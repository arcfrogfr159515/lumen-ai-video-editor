/**
 * What the readout beside the pointer says while a clip is dropped with Ctrl or Shift held, an edge is trimmed, or a
 * fade is pulled. (The other gestures' readouts are single sentences, said where they are made.)
 *
 * These three were put together from English words as they are written — "ripple", "Overwrite at", "Fade in" — and
 * stayed English in a window that speaks another language. Each is a sentence the dictionary has, like the others.
 */
import { tt } from '@/lib/i18n'

/** A clip dropped exactly where it is let go: `at` is the timecode it lands on. */
export const dropReadout = (mode: 'insert' | 'overwrite', at: string) => (mode === 'insert' ? tt('Insert at {0}', at) : tt('Overwrite at {0}', at))

/** An edge being trimmed: how long the clip is now, and where the edge is — or that everything after it follows. */
export const trimReadout = (length: string, ripple: boolean, at: string) => (ripple ? tt('{0}  ·  ripple', length) : tt('{0}  ·  {1}  ·  Ctrl ripple', length, at))

/** A fade being pulled longer or shorter. */
export const fadeReadout = (which: 'fadeIn' | 'fadeOut', length: string) => `${which === 'fadeIn' ? tt('Fade in') : tt('Fade out')}  ${length}`
