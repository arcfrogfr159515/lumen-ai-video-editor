import { Check, ChevronRight } from 'lucide-react'
import { ContextMenu, DropdownMenu } from 'radix-ui'
import { createContext, useContext, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { Kbd, KeyCombo } from './kbd'
import { tt } from '@/lib/i18n'

const contentClass =
  'popover z-[100] min-w-[220px] overflow-hidden p-1 data-[state=open]:animate-pop-in data-[state=closed]:animate-pop-out'

const itemClass =
  'group/item relative flex h-8 cursor-default items-center gap-2.5 rounded-control-sm px-2 text-sm text-fg-2 outline-none select-none data-[highlighted]:bg-ink/[0.07] data-[highlighted]:text-fg data-[disabled]:pointer-events-none data-[disabled]:opacity-40 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-fg-3 data-[highlighted]:[&_svg]:text-fg-2'

/**
 * A long context menu (a clip's has some thirty rows) is drawn dense: lower rows, names without icons, shortcuts
 * as caps and a letter — and it scrolls where the window is too short for it. Its submenus are dense with it.
 */
const Dense = createContext(false)
const denseContentClass = 'min-w-[244px] overflow-x-hidden overflow-y-auto max-h-(--radix-context-menu-content-available-height)'
const denseSubContentClass = 'min-w-[128px] overflow-x-hidden overflow-y-auto max-h-(--radix-context-menu-content-available-height)'
const denseItemClass = 'h-7 gap-2 rounded-md pr-2 pl-2.5'

interface ItemProps {
  icon?: ReactNode
  shortcut?: string
  danger?: boolean
  disabled?: boolean
  /** A setting that is on: shows a tick. */
  checked?: boolean
  /** Drawn right after the name: what kind of thing it is (a `MenuBadge`). */
  badge?: ReactNode
  onSelect?: () => void
  children: ReactNode
}

const Tick = () => <Check className="!size-3.5 !text-accent-2" strokeWidth={2.5} aria-label={tt('On')} />

/** A name with something after it, the pair taking the room a name alone would. */
const named = (name: ReactNode, badge: ReactNode, truncate = true) =>
  badge ? (
    <span className="flex min-w-0 flex-1 items-center gap-1.5">
      <span className="truncate">{name}</span>
      {badge}
    </span>
  ) : (
    <span className={cn('flex-1', truncate && 'truncate')}>{name}</span>
  )

/** A small pill after a menu item's name, in the colours of what the AI does. */
export function MenuBadge({ children }: { children: ReactNode }) {
  return <span className="bg-ai shrink-0 rounded-full px-1.5 text-2xs leading-[15px] font-semibold text-accent-fg">{children}</span>
}

// ─── Dropdown ────────────────────────────────────────────────────────────

export const Menu = DropdownMenu.Root
export const MenuTrigger = DropdownMenu.Trigger

export function MenuContent({ children, align = 'start', side = 'bottom', className }: { children: ReactNode; align?: 'start' | 'center' | 'end'; side?: 'top' | 'bottom' | 'left' | 'right'; className?: string }) {
  return (
    <DropdownMenu.Portal>
      <DropdownMenu.Content
        align={align}
        side={side}
        sideOffset={6}
        collisionPadding={8}
        className={cn(contentClass, 'origin-(--radix-dropdown-menu-content-transform-origin)', className)}
      >
        {children}
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  )
}

export function MenuItem({ icon, shortcut, danger, disabled, checked, onSelect, children }: ItemProps) {
  return (
    <DropdownMenu.Item disabled={disabled} onSelect={onSelect} className={cn(itemClass, danger && 'text-danger data-[highlighted]:text-danger [&_svg]:text-danger/80')}>
      {icon}
      <span className="flex-1 truncate">{children}</span>
      {checked && <Tick />}
      {shortcut && <Kbd combo={shortcut} bound />}
    </DropdownMenu.Item>
  )
}

export function MenuSeparator() {
  return <DropdownMenu.Separator className="mx-1 my-1 h-px bg-line" />
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <DropdownMenu.Label className="px-2 pt-1.5 pb-1 text-2xs font-semibold tracking-wider text-fg-4 uppercase">{children}</DropdownMenu.Label>
}

export function MenuSub({ icon, label, children }: { icon?: ReactNode; label: ReactNode; children: ReactNode }) {
  return (
    <DropdownMenu.Sub>
      <DropdownMenu.SubTrigger className={cn(itemClass, 'data-[state=open]:bg-ink/[0.07]')}>
        {icon}
        <span className="flex-1">{label}</span>
        <ChevronRight className="!size-3.5" />
      </DropdownMenu.SubTrigger>
      <DropdownMenu.Portal>
        <DropdownMenu.SubContent sideOffset={6} alignOffset={-4} className={cn(contentClass, 'origin-(--radix-dropdown-menu-content-transform-origin)')}>
          {children}
        </DropdownMenu.SubContent>
      </DropdownMenu.Portal>
    </DropdownMenu.Sub>
  )
}

// ─── Context menu ────────────────────────────────────────────────────────

export const ContextRoot = ContextMenu.Root
export const ContextTrigger = ContextMenu.Trigger

export function ContextContent({ children, dense = false }: { children: ReactNode; /** Lower rows and no icons, for a long menu. */ dense?: boolean }) {
  return (
    <ContextMenu.Portal>
      <ContextMenu.Content collisionPadding={8} className={cn(contentClass, dense && denseContentClass, 'origin-(--radix-context-menu-content-transform-origin)')}>
        <Dense value={dense}>{children}</Dense>
      </ContextMenu.Content>
    </ContextMenu.Portal>
  )
}

export function ContextItem({ icon, shortcut, danger, disabled, checked, badge, onSelect, children }: ItemProps) {
  const dense = useContext(Dense)
  return (
    <ContextMenu.Item disabled={disabled} onSelect={onSelect} className={cn(itemClass, dense && denseItemClass, danger && 'text-danger data-[highlighted]:text-danger [&_svg]:text-danger/80')}>
      {icon}
      {named(children, badge)}
      {checked && <Tick />}
      {shortcut && (dense ? <KeyCombo combo={shortcut} bound /> : <Kbd combo={shortcut} bound />)}
    </ContextMenu.Item>
  )
}

export function ContextSeparator() {
  // A dense menu reads tighter: its group dividers sit closer than a roomy menu's.
  const dense = useContext(Dense)
  return <ContextMenu.Separator className={cn('mx-1 h-px bg-line', dense ? 'my-[3px]' : 'my-1')} />
}

export function ContextSub({ icon, label, badge, disabled, children }: { icon?: ReactNode; label: ReactNode; badge?: ReactNode; disabled?: boolean; children: ReactNode }) {
  const dense = useContext(Dense)
  return (
    <ContextMenu.Sub>
      <ContextMenu.SubTrigger disabled={disabled} className={cn(itemClass, dense && denseItemClass, 'data-[state=open]:bg-ink/[0.07]')}>
        {icon}
        {named(label, badge, false)}
        <ChevronRight className="!size-3.5" />
      </ContextMenu.SubTrigger>
      <ContextMenu.Portal>
        <ContextMenu.SubContent
          sideOffset={6}
          alignOffset={-4}
          collisionPadding={dense ? 8 : undefined}
          className={cn(contentClass, dense && denseSubContentClass, 'origin-(--radix-context-menu-content-transform-origin)')}
        >
          {children}
        </ContextMenu.SubContent>
      </ContextMenu.Portal>
    </ContextMenu.Sub>
  )
}
