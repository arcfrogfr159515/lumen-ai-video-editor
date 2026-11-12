import { beforeEach, describe, expect, it } from 'vitest'
import { bindKey, boundCombo, comboFromEvent, defineShortcuts, holderOf, isCustom, keysOf, matchesCombo, parseCombo, readCustom, resetKeys, typesText, unbindKeys, useKeyBindings } from './keybindings'
import { formatShortcut } from './platform'

/** A key press, as the keyboard event has it (the tests run as if on Windows: mod is Ctrl). */
const press = (key: string, held: { ctrl?: boolean; alt?: boolean; shift?: boolean; meta?: boolean } = {}) => ({ key, ctrlKey: Boolean(held.ctrl), altKey: Boolean(held.alt), shiftKey: Boolean(held.shift), metaKey: Boolean(held.meta) })

describe('key combos', () => {
  it('match the key press they are, and no other', () => {
    expect(matchesCombo(press('s'), 's')).toBe(true)
    expect(matchesCombo(press('S', { shift: true }), 's')).toBe(false)
    expect(matchesCombo(press('s', { ctrl: true }), 's')).toBe(false)
    expect(matchesCombo(press('Z', { ctrl: true, shift: true }), 'mod+shift+z')).toBe(true)
    expect(matchesCombo(press('z', { ctrl: true }), 'mod+shift+z')).toBe(false)
    expect(matchesCombo(press('s', { alt: true }), 'alt+s')).toBe(true)
    expect(matchesCombo(press('ArrowLeft', { shift: true }), 'shift+left')).toBe(true)
    expect(matchesCombo(press(' '), 'space')).toBe(true)
    expect(matchesCombo(press('Escape'), 'esc')).toBe(true)
    // A symbol is itself however it is typed: ? is Shift+/ on most keyboards, and nobody writes "shift+?".
    expect(matchesCombo(press('?', { shift: true }), '?')).toBe(true)
    expect(matchesCombo(press('+', { shift: true }), '+')).toBe(true)
    expect(matchesCombo(press('+', { ctrl: true, shift: true }), 'mod++')).toBe(true)
  })

  it('are read off a key press in one way of writing them', () => {
    expect(comboFromEvent(press('S', { ctrl: true, shift: true }))).toBe('mod+shift+s')
    expect(comboFromEvent(press('s', { ctrl: true, alt: true, shift: true }))).toBe('mod+alt+shift+s')
    expect(comboFromEvent(press('ArrowUp', { alt: true }))).toBe('alt+up')
    expect(comboFromEvent(press('?', { shift: true }))).toBe('?')
    expect(comboFromEvent(press('+', { ctrl: true, shift: true }))).toBe('mod++')
    expect(comboFromEvent(press('F5'))).toBe('f5')
    expect(comboFromEvent(press(' ', { shift: true }))).toBe('shift+space')
    // Not something a shortcut can be on: a modifier on its way to a combo, the key that moves the focus, the Windows key.
    expect([press('Control', { ctrl: true }), press('Shift', { shift: true }), press('Tab'), press('CapsLock'), press('Process'), press('s', { meta: true })].map(comboFromEvent)).toEqual([null, null, null, null, null, null])
  })

  it('made from a key press match that key press', () => {
    for (const e of [press('d'), press('D', { shift: true }), press('8', { ctrl: true }), press('*', { shift: true }), press('Delete', { shift: true }), press('+', { shift: true, alt: true }), press('PageDown')]) {
      const combo = comboFromEvent(e)
      expect(combo).not.toBeNull()
      expect(matchesCombo(e, combo!), combo!).toBe(true)
    }
  })

  it('are told apart by whether they are what typing is made of', () => {
    expect(['s', 'shift+s', 'space', 'backspace', 'left', '?', 'enter'].map(typesText)).toEqual([true, true, true, true, true, true, true])
    expect(['mod+s', 'alt+s', 'mod+shift+z', 'f5', 'shift+f2'].map(typesText)).toEqual([false, false, false, false, false])
  })

  it('are taken apart and drawn with + as a key like any other', () => {
    expect(parseCombo('mod+alt+enter')).toEqual({ mod: true, alt: true, shift: false, key: 'enter' })
    expect(parseCombo('+')).toEqual({ mod: false, alt: false, shift: false, key: '+' })
    expect(parseCombo('mod++')).toEqual({ mod: true, alt: false, shift: false, key: '+' })
    expect(formatShortcut('mod++')).toEqual(['Ctrl', '+'])
    expect(formatShortcut('+')).toEqual(['+'])
    expect(formatShortcut('alt+shift+pagedown')).toEqual(['Alt', 'Shift', 'PgDn'])
    expect(formatShortcut('mod+shift+z')).toEqual(['Ctrl', 'Shift', 'Z'])
  })
})

describe('the keys shortcuts are on', () => {
  beforeEach(() => {
    defineShortcuts([
      { id: 'split', keys: ['s', 'mod+b'] },
      { id: 'scene-split', keys: ['alt+s'] },
      { id: 'save', keys: ['mod+s'] },
    ])
    resetKeys()
  })

  it('are the ones they come with until they are changed', () => {
    expect(keysOf('split')).toEqual(['s', 'mod+b'])
    expect(isCustom('split')).toBe(false)
    expect(holderOf('mod+b')).toBe('split')
    expect(holderOf('mod+b', 'split')).toBeUndefined()
    expect(holderOf('d')).toBeUndefined()
    // What the interface writes is drawn as written — the second of a shortcut's keys too, and keys that are nobody's.
    expect(['s', 'mod+b', 'alt+s', 'up'].map((c) => boundCombo(c))).toEqual(['s', 'mod+b', 'alt+s', 'up'])
    expect(keysOf('no-such-shortcut')).toEqual([])
  })

  it('move with their shortcut: what was written for it is drawn as the keys it has now', () => {
    bindKey('scene-split', 'd')
    expect(keysOf('scene-split')).toEqual(['d'])
    expect(isCustom('scene-split')).toBe(true)
    expect(boundCombo('alt+s')).toBe('d')
    expect(holderOf('d')).toBe('scene-split')
    expect(holderOf('alt+s')).toBeUndefined()
    expect(useKeyBindings.getState().custom).toEqual({ 'scene-split': ['d'] })
  })

  it('belong to one shortcut: given to another, they are taken from the one that had them', () => {
    bindKey('scene-split', 's')
    expect(keysOf('scene-split')).toEqual(['s'])
    expect(keysOf('split')).toEqual(['mod+b'])
    expect(holderOf('s')).toBe('scene-split')
    // Split's rows, written with either of its keys, show the key it has left.
    expect([boundCombo('s'), boundCombo('mod+b')]).toEqual(['mod+b', 'mod+b'])
    bindKey('save', 'mod+b')
    expect(keysOf('split')).toEqual([])
    expect(boundCombo('s')).toBeUndefined()
  })

  it('can be taken away, and given back', () => {
    unbindKeys('save')
    expect(keysOf('save')).toEqual([])
    expect(boundCombo('mod+s')).toBeUndefined()
    expect(holderOf('mod+s')).toBeUndefined()
    resetKeys('save')
    expect(keysOf('save')).toEqual(['mod+s'])
    expect(isCustom('save')).toBe(false)
  })

  it('go back to the ones a shortcut came with — taken back from where they went', () => {
    bindKey('scene-split', 's')
    resetKeys('split')
    expect(keysOf('split')).toEqual(['s', 'mod+b'])
    expect(isCustom('split')).toBe(false)
    expect(keysOf('scene-split')).toEqual([])
    // Put back by hand on the keys it came with, a shortcut isn't a changed one either.
    bindKey('scene-split', 'alt+s')
    expect(useKeyBindings.getState().custom).toEqual({})
    bindKey('save', 'f5')
    bindKey('split', 'x')
    resetKeys()
    expect(useKeyBindings.getState().custom).toEqual({})
  })

  it('are kept only where what was stored can be read', () => {
    // One shortcut's keys that can't be read leave that shortcut as it comes; the others keep theirs.
    expect(readCustom({ split: ['x'], save: 'mod+s', 'scene-split': ['alt+s', 7], gone: [], long: ['a'.repeat(50)], odd: ['mod+tab'] })).toEqual({ split: ['x'], gone: [] })
    expect([readCustom(['s']), readCustom(null), readCustom('s')]).toEqual([undefined, undefined, undefined])
  })
})
