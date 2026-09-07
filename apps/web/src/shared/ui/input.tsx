import type { ComponentProps } from 'react'
import { cn } from './cn'

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return (
    <input
      className={cn(
        'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors',
        'placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        'disabled:cursor-not-allowed disabled:opacity-50',
        // Invalid state rides on aria-invalid, so the colour and the thing a
        // screen reader announces can never disagree.
        'aria-invalid:border-destructive aria-invalid:focus-visible:ring-destructive',
        className,
      )}
      {...props}
    />
  )
}

export function Label({ className, ...props }: ComponentProps<'label'>) {
  return <label className={cn('text-sm font-medium', className)} {...props} />
}

/**
 * Chevron-down (Lucide path) painted as a background layer so every dropdown
 * shares one arrow instead of each browser's native one. Spaces are %20 (never
 * underscores — Tailwind preserves underscores verbatim inside url()) and
 * `stroke` is currentColor so the arrow follows the text color in both themes.
 */
const SELECT_CHEVRON =
  "bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20width=%2716%27%20height=%2716%27%20viewBox=%270%200%2024%2024%27%20fill=%27none%27%20stroke=%27currentColor%27%20stroke-width=%272%27%20stroke-linecap=%27round%27%20stroke-linejoin=%27round%27%3E%3Cpath%20d=%27m6%209%206%206%206-6%27/%3E%3C/svg%3E')]"

export function Select({ className, ...props }: ComponentProps<'select'>) {
  return (
    <select
      className={cn(
        'flex h-9 w-full appearance-none truncate rounded-md border border-input bg-background py-1 pr-8 pl-3 text-sm shadow-sm transition-colors',
        'bg-no-repeat bg-[position:right_0.625rem_center] [background-size:1rem]',
        SELECT_CHEVRON,
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        'disabled:cursor-not-allowed disabled:opacity-50',
        // Same invalid contract as Input: colour and screen-reader announcement
        // can never disagree.
        'aria-invalid:border-destructive aria-invalid:focus-visible:ring-destructive',
        // The opened option list is OS-rendered; without this it stays
        // light-themed (with a light scrollbar) while the app is dark.
        '[color-scheme:light] dark:[color-scheme:dark]',
        className,
      )}
      {...props}
    />
  )
}
