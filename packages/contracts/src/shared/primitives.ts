import { z } from 'zod'
import { normalizePhone } from './phone'

/** A tenant/company id and other row ids are UUIDs. */
export const uuid = z.string().uuid()

/** ISO-8601 timestamp string (what Postgres/PostgREST returns). */
export const isoDateTime = z.string().datetime({ offset: true })

/** Calendar date, no time — "YYYY-MM-DD". */
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')

export const email = z.string().trim().toLowerCase().email()

/** Phone that self-normalises to the canonical dedupe form; rejects junk. */
export const phone = z.string().transform((v, ctx) => {
  const n = normalizePhone(v)
  if (n === null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'invalid phone number' })
    return z.NEVER
  }
  return n
})

/** Non-negative money, stored in whole currency units (paise handled in domain). */
export const money = z.number().finite().nonnegative()

/** Indian GST rate as a percentage (0, 5, 12, 18, 28). */
export const gstRate = z
  .number()
  .refine((r) => [0, 5, 12, 18, 28].includes(r), 'not a valid GST slab')

/** Cursor-based pagination request. */
export const pagination = z.object({
  cursor: z.string().nullish(),
  limit: z.number().int().min(1).max(100).default(25),
})
export type Pagination = z.infer<typeof pagination>

/** Standard list envelope — every list endpoint returns this shape. */
export function paginated<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    items: z.array(item),
    next_cursor: z.string().nullable(),
  })
}

/** Uniform error body. Error strings are UI copy; diagnostics stay in logs. */
export const apiError = z.object({
  error: z.string(),
  code: z.string().optional(),
})
export type ApiError = z.infer<typeof apiError>
