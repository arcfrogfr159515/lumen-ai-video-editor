/**
 * Every shortcut and the keys it is on — and where those keys are changed: click a shortcut's keys and press
 * the new ones. Keys another shortcut has are asked about before they are taken from it.
 */
import { RotateCcw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button, IconButton } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Kbd } from '@/components/ui/kbd'
import { useUI } from '@/editor/ui-store'
import { cn } from '@/lib/cn'
import { tm, tt } from '@/lib/i18n'
import { ttx } from '@/lib/i18n-react'
import { bindKey, comboFromEvent, holderOf, isCustom, keysOf, resetKeys, unbindKeys, useKeyBindings } from '@/lib/keybindings'
import { SHORTCUTS, type Shortcut } from './shortcuts'

const GROUPS: Shortcut['group'][] = [tm('Playback'), tm('Editing'), tm('Multicam'), tm('Tools'), tm('View'), tm('App')]

/** The shortcut being given keys — and, when the keys pressed are another shortcut's, which, until that is settled. */
interface Editing {
  id: string
  clash?: { combo: string; holder: Shortcut }
}

export function ShortcutsDialog() {
  const open = useUI((s) => s.shortcutsOpen)
  const setOpen = useUI((s) => s.setShortcutsOpen)
  return (
    <Dialog open={open} onOpenChange={setOpen} title={tt('Keyboard shortcuts')} description={tt('Work at the speed of thought — every action has a key.')} className="w-[min(820px,calc(100vw-32px))]">
      {open && <Body />}
    </Dialog>
  )
}

function Body() {
  const [editing, setEditing] = useState<Editing | null>(null)
  const changed = useKeyBindings((s) => SHORTCUTS.some((x) => isCustom(x.id, s.custom)))
  const id = editing?.id

  useEffect(() => {
    if (!id) return
    // While a shortcut is being given keys, a key press is those keys: it runs nothing and closes nothing.
    const onKeyDown = (e: KeyboardEvent) => {
      // Tab still moves the focus, to the buttons that settle a clash — which are pressed as buttons are.
      if (e.key === 'Tab' || (e.target as HTMLElement | null)?.closest?.('[data-keys-prompt]')) return
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') return setEditing(null)
      const combo = comboFromEvent(e)
      if (!combo) return
      const held = holderOf(combo, id)
      const holder = held && SHORTCUTS.find((s) => s.id === held)
      if (holder) return setEditing({ id, clash: { combo, holder } })
      bindKey(id, combo)
      setEditing(null)
    }
    const onPointerDown = (e: PointerEvent) => {
      if (!(e.target as HTMLElement | null)?.closest?.(`[data-shortcut="${id}"]`)) setEditing(null)
    }
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('pointerdown', onPointerDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('pointerdown', onPointerDown, true)
    }
  }, [id])

  return (
    <>
      <div className="grid max-h-[min(70vh,calc(100vh-200px))] grid-cols-2 gap-x-8 gap-y-6 overflow-y-auto px-5 pt-2 pb-5">
        {GROUPS.map((group) => (
          <div key={group}>
            <h3 className="mb-2 text-2xs font-semibold tracking-wider text-fg-4 uppercase">{tt(group)}</h3>
            <div className="space-y-0.5">
              {SHORTCUTS.filter((s) => s.group === group).map((s) => (
                <Row key={s.id} shortcut={s} editing={editing?.id === s.id ? editing : null} onEdit={() => setEditing({ id: s.id })} onDone={() => setEditing(null)} />
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3 border-t border-line bg-shade/15 px-5 py-3.5">
        <p className="min-w-0 flex-1 text-xs leading-relaxed text-fg-3">{tt('To change a shortcut, click its keys and press the new ones. Esc leaves it as it was.')}</p>
        <Button
          size="sm"
          variant="ghost"
          disabled={!changed}
          onClick={() => {
            resetKeys()
            setEditing(null)
          }}
        >
          <RotateCcw />{' '}{tt('Restore all shortcuts')}
        </Button>
      </div>
    </>
  )
}

function Row({ shortcut, editing, onEdit, onDone }: { shortcut: Shortcut; editing: Editing | null; onEdit: () => void; onDone: () => void }) {
  const keys = useKeyBindings((s) => keysOf(shortcut.id, s.custom))
  const custom = useKeyBindings((s) => isCustom(shortcut.id, s.custom))
  const clash = editing?.clash
  return (
    <div data-shortcut={shortcut.id} className={cn('rounded-md px-2 text-sm text-fg-2', editing ? 'bg-accent/10 shadow-[inset_0_0_0_1px_rgb(from_var(--color-accent)_r_g_b/0.4)]' : 'hover:bg-ink/[0.03]')}>
      <div className="flex h-7 items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate">{shortcut.label}</span>
        {editing ? (
          <>
            <span className="shrink-0 text-2xs font-medium text-accent-2">{tt('Press the new keys…')}</span>
            {keys.length > 0 && (
              <Button
                size="xs"
                variant="ghost"
                className="-mr-1"
                onClick={() => {
                  unbindKeys(shortcut.id)
                  onDone()
                }}
              >
                {tt('Remove')}
              </Button>
            )}
          </>
        ) : (
          <>
            {custom && (
              <IconButton size="xs" label={tt('Back to the keys it came with')} onClick={() => resetKeys(shortcut.id)}>
                <RotateCcw />
              </IconButton>
            )}
            <button
              type="button"
              onClick={onEdit}
              aria-label={tt('Change the keys for {0}', shortcut.label)}
              className="-mr-1 flex h-6 shrink-0 items-center rounded-md px-1 outline-none hover:bg-ink/[0.07] focus-visible:ring-2 focus-visible:ring-accent/60"
            >
              {keys.length ? <Kbd combo={keys[0]} className={cn(custom && '[&_kbd]:bg-accent/16 [&_kbd]:text-accent-2')} /> : <span className="px-0.5 text-2xs text-fg-4">{tt('None')}</span>}
            </button>
          </>
        )}
      </div>
      {clash && (
        <div data-keys-prompt className="flex items-center gap-2 pb-1.5 text-2xs leading-relaxed text-fg-3">
          <span className="min-w-0 flex-1">{ttx('{0} is the shortcut for “{1}”.', <Kbd combo={clash.combo} className="mr-0.5 align-middle" />, clash.holder.label)}</span>
          <Button
            size="xs"
            variant="secondary"
            onClick={() => {
              bindKey(shortcut.id, clash.combo)
              onDone()
            }}
          >
            {tt('Move it here')}
          </Button>
        </div>
      )}
    </div>
  )
}
