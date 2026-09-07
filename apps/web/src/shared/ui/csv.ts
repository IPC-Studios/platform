/**
 * Exporting a table the way people expect it: a file that opens in Excel with
 * the columns intact.
 *
 * The quoting rule is RFC 4180's — a cell containing a comma, a quote or a
 * newline is wrapped and its quotes doubled. A studio name like "Roy, Jr." is
 * exactly the kind of thing that silently shifts every later column when this
 * is skipped.
 */
const cell = (v: string | number | null | undefined): string => {
  const s = v === null || v === undefined ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(
  headers: readonly string[],
  rows: readonly (readonly (string | number | null | undefined)[])[],
): string {
  return [headers.map(cell).join(','), ...rows.map((r) => r.map(cell).join(','))].join('\n')
}

/**
 * Hand the browser a file. The BOM is there so Excel on Windows reads the
 * rupee sign and Indian names as UTF-8 rather than mojibake.
 */
export function downloadCsv(filename: string, text: string): void {
  const blob = new Blob(['﻿', text], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
