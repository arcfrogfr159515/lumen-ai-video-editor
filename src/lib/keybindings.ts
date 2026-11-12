/**
 * Which keys run which shortcut.
 *
 * Every shortcut comes with keys of its own (features/shell/shortcuts.ts). What the user changes is kept here,
 * in this profile: for a shortcut that was changed, the whole list of its keys — an empty list for one whose
 * keys were taken away. No two shortcuts have the same keys: giving a shortcut keys that another has takes
 * them from that one.
 *
 * The interface names a shortcut by keys it came with — `shortcut="mod+c"` on a menu row — and draws the keys
 * it has now (`boundCombo`), so a row follows its shortcut wherever the user moves it.
 *
 * A combo is written "mod+alt+shift+key", the modifiers it has in that order. "mod" is Ctrl, or ⌘ on a Mac.
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { kept, quietStorage, type Read } from './persisted'
import { platform } from './platform'

export interface ShortcutKeys {
  id: string
  /** The keys it comes with. */
  keys: readonly string[]
}

// ─── Keys ────────────────────────────────────────────────────────────────

type KeyPress = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>

const KEY_NAMES: Record<string, string> = {
  ' ': 'space',
  arrowleft: 'left',
  arrowright: 'right',
  arrowup: 'up',
  arrowdown: 'down',
  escape: 'esc',
}

/** Keys with a name that a shortcut can be on; a key that types one character is itself. */
const NAMED = new Set(['space', 'left', 'right', 'up', 'down', 'enter', 'esc', 'delete', 'backspace', 'home', 'end', 'pageup', 'pagedown', 'insert', ...Array.from({ length: 12 }, (_, i) => `f${i + 1}`)])

function keyName(e: Pick<KeyboardEvent, 'key'>) {
  // A browser filling in a field sends key presses with no key at all.
  const k = typeof e.key === 'string' ? e.key.toLowerCase() : ''
  return KEY_NAMES[k] ?? k
}

/** A symbol says by itself whether Shift was held to type it (? is Shift+/ on most layouts): no "shift+" is asked of it. */
const shiftFree = (key: string) => key.length === 1 && !/[a-z0-9]/.test(key)

export function parseCombo(combo: string) {
  // The key may be "+" itself: "+" alone, or "mod++".
  const plus = combo === '+' || combo.endsWith('++')
  const parts = plus ? combo.slice(0, -1).split('+').filter(Boolean) : combo.split('+')
  const key = plus ? '+' : (parts.pop() ?? '')
  return { mod: parts.includes('mod'), alt: parts.includes('alt'), shift: parts.includes('shift'), key }
}

export function matchesCombo(e: KeyPress, combo: string) {
  const want = parseCombo(combo)
  const mod = platform.isMac ? e.metaKey : e.ctrlKey
  if (mod !== want.mod || e.altKey !== want.alt) return false
  if (!shiftFree(want.key) && e.shiftKey !== want.shift) return false
  return keyName(e) === want.key
}

/**
 * Whether a combo is what typing is made of: a key by itself or with Shift — a letter, Backspace, an arrow. In
 * a text field those keys are for the text, whichever shortcut the user has put on them.
 */
export function typesText(combo: string) {
  const { mod, alt, key } = parseCombo(combo)
  return !mod && !alt && !/^f\d+$/.test(key)
}

/**
 * The combo a key press is, or null when it isn't one a shortcut can be on: a modifier by itself, a key with
 * no name here (Tab, which moves the focus; the lock keys), or one held with the other platform's modifier.
 */
export function comboFromEvent(e: KeyPress): string | null {
  const key = keyName(e)
  if (!(NAMED.has(key) || [...key].length === 1)) return null
  if (platform.isMac ? e.ctrlKey : e.metaKey) return null
  const mod = platform.isMac ? e.metaKey : e.ctrlKey
  return [...(mod ? ['mod'] : []), ...(e.altKey ? ['alt'] : []), ...(e.shiftKey && !shiftFree(key) ? ['shift'] : []), key].join('+')
}

// ─── What was changed ────────────────────────────────────────────────────

interface KeyBindings {
  /** Shortcut id → its keys, for the shortcuts that don't have the keys they came with. */
  custom: Record<string, string[]>
}

const wellFormed = (combo: unknown): combo is string => {
  if (typeof combo !== 'string' || !combo || combo.length > 40) return false
  const { key } = parseCombo(combo)
  return NAMED.has(key) || [...key].length === 1
}

/** What was kept of the changes: per shortcut, the keys that can be read. One that can't be leaves its shortcut as it comes. */
export const readCustom: Read<Record<string, string[]>> = (v) => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined
  const out: Record<string, string[]> = {}
  for (const [id, keys] of Object.entries(v)) if (Array.isArray(keys) && keys.length <= 8 && keys.every(wellFormed)) out[id] = keys
  return out
}

export const useKeyBindings = create<KeyBindings>()(
  persist((): KeyBindings => ({ custom: {} }), {
    name: 'lumen.keys.v1',
    storage: quietStorage<KeyBindings>(),
    merge: kept<KeyBindings>({ custom: readCustom }),
  }),
)

/** The keys every shortcut comes with, and which shortcut each of those belongs to. */
let defaults = new Map<string, readonly string[]>()
let owners = new Map<string, string>()

/** Tells this module the shortcuts there are (once, as they are defined). */
export function defineShortcuts(shortcuts: readonly ShortcutKeys[]) {
  defaults = new Map(shortcuts.map((s) => [s.id, s.keys]))
  owners = new Map()
  for (const s of shortcuts) for (const combo of s.keys) if (!owners.has(combo)) owners.set(combo, s.id)
}

const current = () => useKeyBindings.getState().custom
const NONE: readonly string[] = []

/** The keys a shortcut has now. */
export const keysOf = (id: string, custom = current()): readonly string[] => custom[id] ?? defaults.get(id) ?? NONE

/** Whether a shortcut's keys are not the ones it came with. */
export const isCustom = (id: string, custom = current()) => id in custom

/** The shortcut that has a combo now (other than `except`), if any. */
export function holderOf(combo: string, except?: string, custom = current()): string | undefined {
  for (const id of defaults.keys()) if (id !== except && keysOf(id, custom).includes(combo)) return id
  return undefined
}

/**
 * What to draw for a combo written in the interface. Written as keys a shortcut came with, it stands for that
 * shortcut: its first key now, or nothing when its keys were taken away. Any other combo is just those keys.
 */
export function boundCombo(combo: string, custom = current()): string | undefined {
  const id = owners.get(combo)
  return id !== undefined && id in custom ? custom[id][0] : combo
}

export const useBoundCombo = (combo: string) => useKeyBindings((s) => boundCombo(combo, s.custom))

const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((k, i) => k === b[i])

/** Sets the keys of some shortcuts, taking each combo from whichever other shortcut has it. */
function assign(changes: Record<string, readonly string[]>) {
  useKeyBindings.setState(({ custom }) => {
    const next: Record<string, string[]> = { ...custom }
    const taken = new Set(Object.values(changes).flat())
    for (const id of defaults.keys()) {
      if (id in changes) continue
      const keys = keysOf(id, custom)
      if (keys.some((k) => taken.has(k))) next[id] = keys.filter((k) => !taken.has(k))
    }
    for (const [id, keys] of Object.entries(changes)) next[id] = [...keys]
    // A shortcut back on the keys it came with isn't a change any more.
    for (const id of Object.keys(next)) if (defaults.has(id) && same(next[id], defaults.get(id)!)) delete next[id]
    return { custom: next }
  })
}

/** Puts a shortcut on one combo — taken from the shortcut that had it, if one did. */
export const bindKey = (id: string, combo: string) => assign({ [id]: [combo] })

/** Takes a shortcut off its keys: nothing runs it until it is given some. */
export const unbindKeys = (id: string) => assign({ [id]: [] })

/** Gives a shortcut back the keys it came with (taking them back from any shortcut they were moved to) — or all of them. */
export function resetKeys(id?: string) {
  if (id === undefined) useKeyBindings.setState({ custom: {} })
  else assign({ [id]: defaults.get(id) ?? [] })
}
