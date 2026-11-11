import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { formatShortcut } from '@/lib/platform'

// Arrow glyphs are too thin at keycap size in most UI fonts — draw them as icons.
const ICONS: Record<string, ReactNode> = {
  '←': <ArrowLeft className="size-2.5" strokeWidth={2.5} />,
  '→': <ArrowRight className="size-2.5" strokeWidth={2.5} />,
  '↑': <ArrowUp className="size-2.5" strokeWidth={2.5} />,
  '↓': <ArrowDown className="size-2.5" strokeWidth={2.5} />,
}

/**
 * A shortcut as a long menu shows it: the keys held (Ctrl, Shift, Alt) and the named ones as caps, the letter
 * pressed with them as a letter — `Ctrl` `Shift` C. It reads faster down a column than a cap for every key.
 */
export function KeyCombo({ combo, className }: { combo: string; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1', className)}>
      {formatShortcut(combo).map((key, i) =>
        /^[A-Z0-9]$/.test(key) ? (
          <span key={i} className="min-w-2.5 text-center font-sans text-xs font-semibold text-fg-2">
            {key}
          </span>
        ) : (
          <kbd key={i} className="inline-flex h-4 min-w-4 items-center justify-center rounded-[4px] bg-canvas px-1 font-sans text-2xs font-semibold text-fg-2 shadow-[inset_0_0_0_1px_rgb(from_var(--color-ink)_r_g_b/0.07)]">
            {ICONS[key] ?? key}
          </kbd>
        ),
      )}
    </span>
  )
}

export function Kbd({ combo, className }: { combo: string; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-0.5', className)}>
      {formatShortcut(combo).map((key, i) => (
        <kbd
          key={i}
          className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[5px] bg-ink/[0.07] px-1 font-sans text-2xs font-medium text-fg-3 shadow-[inset_0_-1px_0_rgb(from_var(--color-ink)_r_g_b/0.06)]"
        >
          {ICONS[key] ?? key}
        </kbd>
      ))}
    </span>
  )
}
