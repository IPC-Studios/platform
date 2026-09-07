/**
 * Filling a terms template in.
 *
 * Templates are written with `{{placeholders}}` because a studio writes them
 * once and sends them fifty times. Substitution happens when a send is created
 * — the rendered words are then stored on the send and never re-derived, so
 * editing the template afterwards cannot change what somebody already agreed
 * to.
 */
export interface TeamTermsVariables {
  company_name?: string | null
  company_address?: string | null
  team_member_name?: string | null
  role?: string | null
  shoot_name?: string | null
  shoot_date?: string | null
  project_name?: string | null
  agreement_date?: string | null
}

/** The placeholders a template may use, for the editor's own reference. */
export const TEAM_TERMS_VARIABLES: readonly (keyof TeamTermsVariables)[] = [
  'company_name',
  'company_address',
  'team_member_name',
  'role',
  'shoot_name',
  'shoot_date',
  'project_name',
  'agreement_date',
]

/**
 * Replace every `{{name}}` with its value.
 *
 * A variable with nothing behind it becomes `______` rather than the empty
 * string: an undertaking that reads "assigned as ______" is obviously
 * unfinished, while one that reads "assigned as  for " looks like a bug the
 * crew member is being asked to sign.
 */
export function renderTeamTerms(body: string, vars: TeamTermsVariables): string {
  return body.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (whole: string, name: string | undefined) => {
    const key = (name ?? '').toLowerCase() as keyof TeamTermsVariables
    // Known variable, no value → a visible blank. Anything else is the
    // studio's own prose and is left exactly as typed.
    if (!TEAM_TERMS_VARIABLES.includes(key)) return whole
    const value = vars[key]
    return value === null || value === undefined || value === '' ? '______' : String(value)
  })
}

/** Which placeholders a template uses, in the order they first appear. */
export function teamTermsVariablesUsed(body: string): string[] {
  const seen: string[] = []
  for (const [, name] of body.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/gi)) {
    const key = (name ?? '').toLowerCase()
    if (key && !seen.includes(key)) seen.push(key)
  }
  return seen
}
