import { Search, X } from 'lucide-react'
import { forwardRef, type InputHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'
import { tt } from '@/lib/i18n'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...props }, ref) {
  return (
    <input
      ref={ref}
      spellCheck={false}
      className={cn(
        'h-8 w-full min-w-0 rounded-control bg-ink/[0.045] px-2.5 text-sm text-fg shadow-[inset_0_0_0_1px_rgb(from_var(--color-ink)_r_g_b/0.06)] outline-none transition-[background-color,box-shadow] placeholder:text-fg-4 hover:bg-ink/[0.06] focus:bg-ink/[0.07] focus:shadow-[inset_0_0_0_1px_rgb(from_var(--color-accent)_r_g_b/0.5),0_0_0_3px_rgb(from_var(--color-accent)_r_g_b/0.12)]',
        className,
      )}
      {...props}
    />
  )
})

interface SearchInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
  value: string
  onChange: (value: string) => void
}

export function SearchInput({ value, onChange, className, ...props }: SearchInputProps) {
  return (
    <div className={cn('relative', className)}>
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-fg-4" />
      <Input value={value} onChange={(e) => onChange(e.target.value)} className="pr-7 pl-8" {...props} />
      {value && (
        <button
          type="button"
          aria-label={tt('Clear search')}
          onClick={() => onChange('')}
          className="absolute top-1/2 right-1.5 grid size-5 -translate-y-1/2 place-items-center rounded-md text-fg-4 hover:bg-ink/[0.08] hover:text-fg-2"
        >
          <X className="size-3" />
        </button>
      )}
    </div>
  )
}
