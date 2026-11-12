import { useEffect } from 'react'
import { handleTrimKey } from '@/editor/trim-session'
import { useUI } from '@/editor/ui-store'
import { keysOf, matchesCombo, typesText } from '@/lib/keybindings'
import { useSession } from '@/project/session'
import { SHORTCUTS } from './shortcuts'

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null
  if (!el) return false
  return el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT'
}

/** Enter on a focused button (or link, tab, menu item…) presses it rather than running a shortcut. */
function pressable(target: EventTarget | null) {
  const el = target as HTMLElement | null
  return Boolean(el?.closest?.('button, a[href], summary, [role="button"], [role="menuitem"], [role="option"], [role="tab"], [role="checkbox"], [role="switch"]'))
}

export function useGlobalShortcuts() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return
      const typing = isTyping(e.target)
      if (e.key === 'Enter' && pressable(e.target)) return
      const { paletteOpen, exportOpen, shortcutsOpen } = useUI.getState()
      const modal = paletteOpen || exportOpen || shortcutsOpen || document.querySelector('[role="menu"],[role="dialog"]')
      // Trim mode takes a few keys for itself (K, the arrows, Tab, Esc); the rest work as always.
      if (!typing && !modal && !useSession.getState().home && handleTrimKey(e)) {
        e.preventDefault()
        return
      }

      for (const s of SHORTCUTS) {
        const combo = keysOf(s.id).find((c) => matchesCombo(e, c))
        if (!combo) continue
        // The start screen only answers to opening a project.
        if (useSession.getState().home && s.id !== 'open') return
        // A shortcut that works while typing does so on keys that don't type: moved onto a letter, it waits like the rest.
        if (typing && (!s.global || typesText(combo))) return
        if (modal && !s.global) return
        e.preventDefault()
        s.run()
        return
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
