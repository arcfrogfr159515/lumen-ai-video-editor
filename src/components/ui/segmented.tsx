import { motion } from 'motion/react'
import { useId, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

interface Option<T extends string> {
  value: T
  label?: ReactNode
  icon?: ReactNode
  title?: string
}

interface SegmentedProps<T extends string> {
  value: T
  options: Option<T>[]
  onChange: (value: T) => void
  size?: 'sm' | 'md'
  className?: string
  stretch?: boolean
}

export function Segmented<T extends string>({ value, options, onChange, size = 'sm', className, stretch }: SegmentedProps<T>) {
  const id = useId()
  return (
    <div
      role="tablist"
      className={cn(
        'inline-flex items-center gap-0.5 rounded-group bg-well-2 p-[3px] shadow-[inset_0_0_0_1px_rgb(from_var(--color-ink)_r_g_b/0.05)]',
        stretch && 'flex w-full',
        className,
      )}
    >
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={active}
            title={o.title}
            onClick={() => onChange(o.value)}
            className={cn(
              'relative inline-flex items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-accent/60 [&_svg]:size-3.5',
              size === 'sm' ? 'h-6 px-2.5 text-xs' : 'h-7 px-3 text-sm',
              stretch && 'flex-1',
              active ? 'text-fg' : 'text-fg-3 hover:text-fg-2',
            )}
          >
            {active && (
              <motion.span
                layoutId={`seg-${id}`}
                className="absolute inset-0 rounded-md bg-surface-5 shadow-[inset_0_1px_0_rgb(from_var(--color-ink)_r_g_b/0.08),0_1px_3px_rgb(from_var(--color-shade)_r_g_b/0.4)]"
                transition={{ type: 'spring', stiffness: 520, damping: 38 }}
              />
            )}
            <span className="relative z-10 inline-flex items-center gap-1.5">
              {o.icon}
              {o.label}
            </span>
          </button>
        )
      })}
    </div>
  )
}
