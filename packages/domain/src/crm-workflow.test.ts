import { describe, expect, it } from 'vitest'
import { conditionOp, describeStep, describeWorkflow, workflowConditionMatches } from './crm-workflow'

const facts = { source: 'facebook', status: 'contacted', is_hot: false, score: 45, deal_value: 80000, email: null, has_email: false, days_since_contact: 3 }

describe('conditionOp', () => {
  it('compares numbers as numbers and text as text', () => {
    expect(conditionOp(45, 'gte', 40)).toBe(true)
    expect(conditionOp(45, 'gte', '50')).toBe(false)
    expect(conditionOp('facebook', 'eq', 'facebook')).toBe(true)
    expect(conditionOp('facebook', 'neq', 'webform')).toBe(true)
    expect(conditionOp('Wedding in Goa', 'contains', 'goa')).toBe(true)
    expect(conditionOp('referral', 'in', ['referral', 'enquiry'])).toBe(true)
    expect(conditionOp(true, 'eq', true)).toBe(true)
  })

  it('handles empty values the way the database does', () => {
    expect(conditionOp(null, 'is_null', undefined)).toBe(true)
    expect(conditionOp(null, 'not_null', undefined)).toBe(false)
    expect(conditionOp(null, 'gte', 1)).toBe(false)
    expect(conditionOp('x', 'not_null', undefined)).toBe(true)
  })
})

describe('workflowConditionMatches', () => {
  it('an empty condition matches everything; every present clause must hold', () => {
    expect(workflowConditionMatches({}, facts)).toBe(true)
    expect(workflowConditionMatches({ source: 'facebook', conditions: [{ field: 'score', op: 'gte', value: 40 }] }, facts)).toBe(true)
    expect(workflowConditionMatches({ source: 'webform' }, facts)).toBe(false)
    expect(workflowConditionMatches({ from_status: 'new', to_status: 'contacted' }, facts, 'new')).toBe(true)
    expect(workflowConditionMatches({ is_hot: true }, facts)).toBe(false)
    expect(workflowConditionMatches({ conditions: [{ field: 'has_email', op: 'eq', value: true }] }, facts)).toBe(false)
  })
})

describe('describeStep / describeWorkflow', () => {
  const names = { user: (id: string) => (id === 'u1' ? 'Meera' : undefined), template: () => 'Welcome' }

  it('reads each step back as a phrase', () => {
    expect(describeStep({ kind: 'delay', config: { amount: 1, unit: 'days' } })).toBe('wait 1 day')
    expect(describeStep({ kind: 'delay', config: { amount: 3, unit: 'hours' } })).toBe('wait 3 hours')
    expect(describeStep({ kind: 'action', config: { action: 'assign_to', user_id: 'u1' } }, names)).toBe('assign it to Meera')
    expect(describeStep({ kind: 'action', config: { action: 'create_task', subject: 'Send brochure', days: 2 } })).toBe('create a task “Send brochure” due in 2 days')
    expect(describeStep({ kind: 'action', config: { action: 'add_score', points: -5 } })).toBe('adjust the score by -5')
    expect(describeStep({ kind: 'action', config: { action: 'send_template', template_id: 't1', channel: 'whatsapp' } }, names)).toBe('send the template “Welcome” via whatsapp')
    expect(describeStep({ kind: 'branch', config: { conditions: [{ field: 'score', op: 'gte', value: 40 }], yes_step: 4, no_step: null } })).toBe('if Score is at least 40 → step 4, else → the next step')
    expect(describeStep({ kind: 'exit', config: {} })).toBe('stop here')
  })

  it('reads a workflow back as one sentence', () => {
    expect(
      describeWorkflow(
        {
          trigger: 'lead_created',
          condition: { source: 'facebook' },
          steps: [
            { kind: 'action', config: { action: 'mark_hot' } },
            { kind: 'delay', config: { amount: 2, unit: 'days' } },
            { kind: 'action', config: { action: 'notify_assignee' } },
          ],
        },
        names,
      ),
    ).toBe('When a lead arrives from facebook: mark it hot; wait 2 days; notify the owner.')
  })
})
