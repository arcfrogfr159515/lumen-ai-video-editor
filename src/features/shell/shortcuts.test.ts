import { describe, expect, it } from 'vitest'
import { bindKey, boundCombo, comboFromEvent, holderOf, keysOf, parseCombo, resetKeys } from '@/lib/keybindings'
import { SHORTCUTS, shortcutFor } from './shortcuts'

describe('the shortcuts Lumen comes with', () => {
  it('each have an id and keys of their own', () => {
    const ids = SHORTCUTS.map((s) => s.id)
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([])
    // The interface names a shortcut by its keys, and a key press runs one shortcut: no combo can be two shortcuts'.
    const combos = SHORTCUTS.flatMap((s) => s.keys)
    expect(combos.filter((c, i) => combos.indexOf(c) !== i)).toEqual([])
    expect(SHORTCUTS.filter((s) => !s.keys.length).map((s) => s.id)).toEqual([])
  })

  it('are on keys written the way a key press is read', () => {
    const odd = SHORTCUTS.flatMap((s) => s.keys).filter((combo) => {
      const { mod, alt, shift, key } = parseCombo(combo)
      return comboFromEvent({ key: key === 'space' ? ' ' : key, ctrlKey: mod, metaKey: false, altKey: alt, shiftKey: shift }) !== combo
    })
    expect(odd).toEqual([])
  })

  it('can be moved to other keys, and the rows written with their own keys follow', () => {
    resetKeys()
    expect(shortcutFor('split')).toBe('s')
    bindKey('marker', 's')
    expect(keysOf('marker')).toEqual(['s'])
    expect(holderOf('s')).toBe('marker')
    // Split keeps the other key it came with, and that is what its rows show now.
    expect(keysOf('split')).toEqual(['mod+b'])
    expect([boundCombo('m'), boundCombo('s')]).toEqual(['s', 'mod+b'])
    resetKeys()
    expect([boundCombo('m'), boundCombo('s')]).toEqual(['m', 's'])
  })

  it('include the smart scene split, on Alt+S', () => {
    resetKeys()
    expect(shortcutFor('scene-split')).toBe('alt+s')
    expect(holderOf('alt+s')).toBe('scene-split')
    expect(SHORTCUTS.find((s) => s.id === 'scene-split')).toMatchObject({ group: 'Editing', label: 'Smart scene split' })
  })
})
