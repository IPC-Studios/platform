import { describe, expect, it } from 'vitest'
import { renderTeamTerms, teamTermsVariablesUsed } from './team-terms'

describe('renderTeamTerms', () => {
  const vars = {
    company_name: 'IPC Studios',
    team_member_name: 'Rahul Sharma',
    role: 'Candid Photographer',
    shoot_name: 'Wedding Day',
    shoot_date: '22 Nov 2026',
  }

  it('fills every placeholder it has a value for', () => {
    expect(
      renderTeamTerms('{{team_member_name}} is booked as {{role}} for {{shoot_name}}.', vars),
    ).toBe('Rahul Sharma is booked as Candid Photographer for Wedding Day.')
  })

  it('ignores spacing inside the braces', () => {
    expect(renderTeamTerms('Between {{ company_name }} and {{team_member_name }}.', vars)).toBe(
      'Between IPC Studios and Rahul Sharma.',
    )
  })

  it('substitutes every occurrence, not just the first', () => {
    expect(renderTeamTerms('{{role}} — {{role}}', vars)).toBe(
      'Candid Photographer — Candid Photographer',
    )
  })

  // A blank in an undertaking has to look blank; "assigned as  for " reads as
  // a bug the crew member is being asked to sign.
  it('leaves a visible blank where a value is missing', () => {
    expect(renderTeamTerms('Address: {{company_address}}.', vars)).toBe('Address: ______.')
    expect(renderTeamTerms('Address: {{company_address}}.', { company_address: '' })).toBe(
      'Address: ______.',
    )
    expect(renderTeamTerms('Address: {{company_address}}.', { company_address: null })).toBe(
      'Address: ______.',
    )
  })

  // Somebody's prose is not ours to eat: an unknown token stays as typed.
  it('leaves a placeholder it does not know alone', () => {
    expect(renderTeamTerms('Pay {{day_rate}} on {{shoot_date}}.', vars)).toBe(
      'Pay {{day_rate}} on 22 Nov 2026.',
    )
  })

  it('returns a body with no placeholders untouched', () => {
    expect(renderTeamTerms('Be on set by 6am.', vars)).toBe('Be on set by 6am.')
  })
})

describe('teamTermsVariablesUsed', () => {
  it('lists each placeholder once, in the order it first appears', () => {
    expect(
      teamTermsVariablesUsed('{{shoot_name}} for {{company_name}}, again {{shoot_name}}.'),
    ).toEqual(['shoot_name', 'company_name'])
  })

  it('is empty for a body with none', () => {
    expect(teamTermsVariablesUsed('Nothing to fill in here.')).toEqual([])
  })
})
