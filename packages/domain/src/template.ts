/**
 * Template variable substitution for quotations / terms / emails.
 * Replaces {{key}} (whitespace-tolerant) with the provided value. Unknown
 * placeholders collapse to an empty string so half-filled docs never leak
 * "{{client_name}}" to a client.
 */
export function renderTemplate(body: string, vars: Record<string, string | number | null | undefined>): string {
  return body.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key: string) => {
    const v = vars[key]
    return v === null || v === undefined ? '' : String(v)
  })
}

/** List the {{placeholders}} referenced by a template. */
export function templateVariables(body: string): string[] {
  const set = new Set<string>()
  for (const m of body.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)) set.add(m[1] as string)
  return [...set]
}
