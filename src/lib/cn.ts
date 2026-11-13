import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

// Teach tailwind-merge about our custom theme scales so they merge instead of stacking.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      shadow: ['panel', 'pop', 'control'],
      radius: ['panel', 'card', 'group', 'control', 'control-sm', 'chip', 'handle'],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
