/**
 * Motion helpers.
 *
 * CSS handles the reduced-motion preference for everything declarative; this
 * is for the cases JavaScript drives, where a `behavior: 'smooth'` option
 * would otherwise override the stylesheet's opt-out.
 */
export function prefersReducedMotion(): boolean {
  return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

/**
 * Bring an element into view, animating only if motion is welcome. Used when a
 * step changes under a long form: the answer moves, so the eye should be taken
 * to it rather than left where the last question ended.
 */
export function scrollIntoView(el: Element | null): void {
  el?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' })
}
