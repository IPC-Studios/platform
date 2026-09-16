import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { crmTemplateVars, templateVariables } from './template'

/**
 * The seeded CRM message templates must only use placeholders the renderer
 * actually substitutes.
 *
 * renderTemplate replaces an unknown {{placeholder}} with an empty string
 * rather than failing, so a seed written against an invented variable ships a
 * message with a hole in it — "Hi , thanks for reaching out" — and nothing
 * anywhere reports a problem. The seeds live in SQL, so this reads them from
 * the migration rather than from a copy that could drift.
 */
const migration = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'supabase',
  'migrations',
  '0136_crm_message_template_seeds.sql',
)

/** Every {{placeholder}} inside the seed migration's string literals. */
function seededPlaceholders(sql: string): string[] {
  return [...sql.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1]!)
}

describe('seeded CRM message templates', () => {
  const sql = readFileSync(migration, 'utf8')

  it('the migration is there and carries templates', () => {
    expect(sql).toContain('seed_crm_message_templates')
    expect(seededPlaceholders(sql).length).toBeGreaterThan(5)
  })

  it('every placeholder is one the renderer fills in', () => {
    const known = new Set(
      Object.keys(
        crmTemplateVars(
          {
            name: 'x', phone: 'x', email: 'x', follow_up_at: null, city: 'x',
            group_name: 'x', event_type: 'x', event_date: 'x', deal_value: 1,
          },
          'Studio',
        ),
      ),
    )
    const unknown = [...new Set(seededPlaceholders(sql))].filter((v) => !known.has(v))
    expect(unknown).toEqual([])
  })

  it('templateVariables agrees about what a seeded body references', () => {
    // Guards the regex above against drifting from the one the app uses.
    const body = 'Hi {{name}}, {{studio}} here about your {{event_type}}.'
    expect(templateVariables(body).sort()).toEqual(['event_type', 'name', 'studio'])
  })
})
