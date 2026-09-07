import { describe, expect, it } from 'vitest'
import { describeRule, ruleMatches } from './crm-automation'

const lead = { source: 'facebook', status: 'contacted', is_hot: false }

describe('ruleMatches', () => {
  it('an empty condition matches everything', () => {
    expect(ruleMatches({}, lead, 'new')).toBe(true)
  })

  it('every present key must match', () => {
    expect(ruleMatches({ source: 'facebook' }, lead, 'new')).toBe(true)
    expect(ruleMatches({ source: 'webform' }, lead, 'new')).toBe(false)
    expect(ruleMatches({ source: 'facebook', to_status: 'qualified' }, lead, 'new')).toBe(false)
    expect(ruleMatches({ from_status: 'new', to_status: 'contacted' }, lead, 'new')).toBe(true)
    expect(ruleMatches({ from_status: 'qualified' }, lead, 'new')).toBe(false)
    expect(ruleMatches({ is_hot: true }, lead, null)).toBe(false)
  })
})

describe('describeRule', () => {
  it('reads back as one sentence', () => {
    expect(
      describeRule({
        trigger: 'lead_created',
        condition: { source: 'facebook' },
        action: 'mark_hot',
        action_value: {},
      }),
    ).toBe('When a lead arrives from facebook, mark it hot.')
    expect(
      describeRule(
        {
          trigger: 'stage_changed',
          condition: { to_status: 'proposal_sent' },
          action: 'set_follow_up_days',
          action_value: { days: 3 },
        },
      ),
    ).toBe('When a lead changes stage into proposal_sent, schedule a follow-up in 3 days.')
    expect(
      describeRule(
        { trigger: 'follow_up_overdue', condition: {}, action: 'assign_to', action_value: { user_id: 'u1' } },
        (id) => (id === 'u1' ? 'Meera' : undefined),
      ),
    ).toBe('When a follow-up is overdue, assign it to Meera.')
  })
})
