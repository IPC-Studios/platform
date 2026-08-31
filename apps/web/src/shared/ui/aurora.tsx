import { cn } from './cn'

/**
 * Soft mesh-gradient wash for full-page surfaces (sign-in, empty states).
 *
 * Three blurred blobs tinted from the tenant's accent, drifting slowly enough
 * to be felt rather than watched. Purely decorative and pointer-transparent, so
 * it never intercepts a click meant for the form on top of it.
 */
export function AuroraBackdrop({ className }: { className?: string }) {
  return (
    <div
      className={cn('pointer-events-none absolute inset-0 overflow-hidden', className)}
      aria-hidden
    >
      <span className="aurora-blob absolute -left-24 -top-32 size-[32rem] rounded-full bg-primary/20 blur-3xl" />
      <span className="aurora-blob aurora-blob--slow absolute -right-32 top-1/4 size-[36rem] rounded-full bg-primary/10 blur-3xl" />
      <span className="aurora-blob aurora-blob--slower absolute bottom-[-14rem] left-1/3 size-[30rem] rounded-full bg-brand/10 blur-3xl" />
    </div>
  )
}
