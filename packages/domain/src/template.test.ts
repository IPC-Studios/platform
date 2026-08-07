import { describe, expect, it } from 'vitest'
import { renderTemplate, templateVariables } from './template'

describe('renderTemplate', () => {
  it('substitutes known placeholders, whitespace-tolerant', () => {
    expect(renderTemplate('Hi {{name}}, total {{ amount }}.', { name: 'Priya', amount: 50000 })).toBe(
      'Hi Priya, total 50000.',
    )
  })
  it('collapses unknown/null placeholders to empty', () => {
    expect(renderTemplate('Dear {{client_name}}!', {})).toBe('Dear !')
    expect(renderTemplate('X {{a}} Y', { a: null })).toBe('X  Y')
  })
})

describe('templateVariables', () => {
  it('lists unique placeholder keys', () => {
    expect(templateVariables('{{a}} {{ b }} {{a}} {{c.d}}')).toEqual(['a', 'b', 'c.d'])
  })
})
