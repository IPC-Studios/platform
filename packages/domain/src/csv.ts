/**
 * CSV, as people actually export it: RFC 4180 quoting, commas and newlines
 * inside quotes, doubled quotes, CRLF or LF, a UTF-8 BOM, and a header row
 * whose names are whatever the spreadsheet called them.
 */

/** Split CSV text into rows of cells. Empty trailing lines are dropped. */
export function parseCsv(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  let i = 0
  while (i < src.length) {
    const ch = src[i]!
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"'
          i += 2
          continue
        }
        quoted = false
        i++
        continue
      }
      cell += ch
      i++
      continue
    }
    if (ch === '"') {
      quoted = true
      i++
      continue
    }
    if (ch === ',') {
      row.push(cell)
      cell = ''
      i++
      continue
    }
    if (ch === '\r') {
      i++
      continue
    }
    if (ch === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
      i++
      continue
    }
    cell += ch
    i++
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

export type LeadColumn = 'name' | 'phone' | 'email' | 'notes' | 'source'

const ALIASES: Record<LeadColumn, readonly string[]> = {
  name: ['name', 'full name', 'fullname', 'client', 'client name', 'lead', 'lead name', 'contact'],
  phone: ['phone', 'phone number', 'mobile', 'mobile number', 'number', 'contact number', 'whatsapp', 'tel', 'telephone'],
  email: ['email', 'e-mail', 'email address', 'mail'],
  notes: ['notes', 'note', 'remarks', 'comments', 'comment', 'message', 'enquiry', 'requirement', 'details'],
  source: ['source', 'lead source', 'channel', 'campaign'],
}

const norm = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/**
 * Work out which column is which from the header row. Returns null when the
 * first row does not look like a header (no phone column anywhere), in which
 * case the caller falls back to positional name, phone, email, notes.
 */
export function mapLeadColumns(header: readonly string[]): Partial<Record<LeadColumn, number>> | null {
  const map: Partial<Record<LeadColumn, number>> = {}
  header.forEach((h, idx) => {
    const key = norm(h)
    for (const col of Object.keys(ALIASES) as LeadColumn[]) {
      if (map[col] === undefined && ALIASES[col].some((a) => norm(a) === key)) map[col] = idx
    }
  })
  return map.phone === undefined ? null : map
}

export interface LeadRecord {
  row: number
  name: string | null
  phone: string | null
  email: string | null
  notes: string | null
  source: string | null
}

const POSITIONAL: Partial<Record<LeadColumn, number>> = { name: 0, phone: 1, email: 2, notes: 3 }

/**
 * Turn parsed rows into lead records. `row` is the 1-based line in the file,
 * so a validation message can point at the spreadsheet line.
 */
export function leadsFromCsv(rows: readonly string[][]): { columns: string[]; records: LeadRecord[] } {
  if (rows.length === 0) return { columns: [], records: [] }
  const header = rows[0]!
  const mapped = mapLeadColumns(header)
  const map = mapped ?? POSITIONAL
  const data = mapped ? rows.slice(1) : rows
  const offset = mapped ? 2 : 1
  const pick = (r: readonly string[], col: LeadColumn): string | null => {
    const idx = map[col]
    if (idx === undefined) return null
    const v = (r[idx] ?? '').trim()
    return v === '' ? null : v
  }
  const records = data.map((r, i) => ({
    row: i + offset,
    name: pick(r, 'name'),
    phone: pick(r, 'phone'),
    email: pick(r, 'email'),
    notes: pick(r, 'notes'),
    source: pick(r, 'source'),
  }))
  return {
    columns: mapped ? header.map((h) => h.trim()) : ['name', 'phone', 'email', 'notes'],
    records,
  }
}
