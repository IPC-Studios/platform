import { describe, expect, it } from 'vitest'
import { toCsv } from './csv'

/**
 * The quoting rule, pinned.
 *
 * Four export screens hand-rolled this and three got it wrong in the same
 * way: they wrapped every cell in quotes but doubled the inner quotes of only
 * one column, so a party or client name containing a quote silently broke the
 * row and shifted every later column. They all go through toCsv() now, which
 * makes this the one place the rule is written down.
 */
describe('toCsv', () => {
  it('writes a header and one line per row', () => {
    const csv = toCsv(['Name', 'Amount'], [['Anita', 1200], ['Imran', 900]])
    expect(csv.split('\n')).toEqual(['Name,Amount', 'Anita,1200', 'Imran,900'])
  })

  it('leaves an ordinary cell alone', () => {
    expect(toCsv(['A'], [['plain']])).toBe('A\nplain')
  })

  it('quotes a cell containing a comma', () => {
    // The classic: without this, "Roy, Jr." becomes two columns and every
    // value after it lands under the wrong heading.
    expect(toCsv(['Name'], [['Roy, Jr.']])).toBe('Name\n"Roy, Jr."')
  })

  it('doubles an inner quote, and quotes the cell', () => {
    expect(toCsv(['Note'], [['He said "hi"']])).toBe('Note\n"He said ""hi"""')
  })

  it('quotes a cell containing a newline or a bare carriage return', () => {
    // A note pasted from Windows carries CRLF; a lone \r splits the row just
    // as surely as \n, and was the one case the rule used to miss.
    expect(toCsv(['Note'], [['line one\nline two']])).toBe('Note\n"line one\nline two"')
    expect(toCsv(['Note'], [['line one\rline two']])).toBe('Note\n"line one\rline two"')
    expect(toCsv(['Note'], [['line one\r\nline two']])).toBe('Note\n"line one\r\nline two"')
  })

  it('writes an empty cell for null and undefined rather than the word', () => {
    // "null" in a spreadsheet column of rupees is worse than a blank.
    expect(toCsv(['A', 'B'], [[null, undefined]])).toBe('A,B\n,')
  })

  it('keeps zero, which is a real number and not a blank', () => {
    expect(toCsv(['Amount'], [[0]])).toBe('Amount\n0')
  })

  it('quotes a header that needs it too', () => {
    expect(toCsv(['Name, legal'], [['x']])).toBe('"Name, legal"\nx')
  })
})
