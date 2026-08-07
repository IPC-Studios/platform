const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
})

/** Display rupees as ₹1,23,456 (Indian grouping). */
export function formatINR(amount: number): string {
  return inr.format(amount)
}

/** "on_hold" → "On hold". For enum-ish codes shown to users. */
export function humanize(code: string): string {
  const s = code.replace(/_/g, ' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}
