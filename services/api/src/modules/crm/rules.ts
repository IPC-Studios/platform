/**
 * Several CRM functions raise a sentence meant for the person at the other
 * end — "Proposal sent is full: its limit is 5 deals.", "Fill in deal value
 * before moving to Won." Those are worth passing through instead of
 * attempt()'s generic 422 copy, so the handler can claim the code and hand
 * the message straight back.
 */
const pgMessage = (err: unknown): string | undefined => {
  const m = (err as { message?: unknown })?.message
  return typeof m === 'string' && m.length > 0 && m.length < 300 ? m : undefined
}

/** Claim a check failure so its own sentence reaches the client. */
export const claimRule = (code: string, err: unknown): { rule: string } | undefined =>
  code === 'P0001' || code === '22023'
    ? { rule: pgMessage(err) ?? 'Please check the details and try again.' }
    : undefined
