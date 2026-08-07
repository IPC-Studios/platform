/**
 * Team-slot overlap. Two bookings for the same member conflict when their time
 * ranges overlap; back-to-back (end == start) is allowed. Pure — mirrors the DB
 * guard and powers the client-side conflict preview before a booking is sent.
 */
export interface TimeSlot {
  start_at: string | Date
  end_at: string | Date
}

const ms = (v: string | Date) => (v instanceof Date ? v.getTime() : new Date(v).getTime())

/** Half-open overlap: [aStart,aEnd) intersects [bStart,bEnd). */
export function overlaps(a: TimeSlot, b: TimeSlot): boolean {
  return ms(a.start_at) < ms(b.end_at) && ms(b.start_at) < ms(a.end_at)
}

/** Every existing slot that clashes with the candidate. */
export function findConflicts<T extends TimeSlot>(candidate: TimeSlot, existing: readonly T[]): T[] {
  return existing.filter((e) => overlaps(candidate, e))
}
