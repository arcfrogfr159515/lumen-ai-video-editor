import { Switch as RadixSwitch } from 'radix-ui'
import { cn } from '@/lib/cn'

interface SwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  className?: string
  'aria-label'?: string
  disabled?: boolean
}

export function Switch({ checked, onChange, className, disabled, ...rest }: SwitchProps) {
  return (
    <RadixSwitch.Root
      checked={checked}
      onCheckedChange={onChange}
      disabled={disabled}
      aria-label={rest['aria-label']}
      className={cn(
        'hit-24 relative inline-flex h-[18px] w-[30px] shrink-0 items-center rounded-full bg-ink/[0.12] p-[2px] outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-accent/60 data-[state=checked]:bg-accent disabled:opacity-40',
        className,
      )}
    >
      <RadixSwitch.Thumb className="block size-[14px] rounded-full bg-ink shadow-[0_1px_3px_rgb(from_var(--color-shade)_r_g_b/0.4)] transition-[translate,background-color] duration-200 ease-[var(--ease-spring)] data-[state=checked]:translate-x-3 data-[state=checked]:bg-accent-fg" />
    </RadixSwitch.Root>
  )
}
