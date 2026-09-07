import { describe, expect, it } from 'vitest'
import { describeActivity, sortTimeline, taskDueBy } from './crm-activity'

const base = { subject: null, outcome: null, duration_s: null, due_at: null, done_at: null }

describe('describeActivity', () => {
  it('reads calls, messages, notes and tasks back as one line', () => {
    expect(describeActivity({ ...base, type: 'call', direction: 'out', duration_s: 660, outcome: 'answered' })).toBe('11m outbound call · Answered')
    expect(describeActivity({ ...base, type: 'email', direction: 'in', subject: 'Re: quote' })).toBe('Inbound email: Re: quote')
    expect(describeActivity({ ...base, type: 'note', direction: 'none', subject: 'Prefers candid' })).toBe('Note: Prefers candid')
    expect(describeActivity({ ...base, type: 'task', direction: 'none', subject: 'Send album', due_at: '2026-09-07T04:30:00Z' }, new Date('2026-09-05T00:00:00Z'))).toBe('Task: Send album · due 7 Sept')
    expect(describeActivity({ ...base, type: 'task', direction: 'none', subject: 'Send album', due_at: '2026-09-01T04:30:00Z' }, new Date('2026-09-05T00:00:00Z'))).toContain('overdue')
    expect(describeActivity({ ...base, type: 'task', direction: 'none', done_at: '2026-09-05T00:00:00Z' })).toBe('Task done')
  })
})

describe('taskDueBy', () => {
  it('is true for an open task owed by the end of the day', () => {
    const eod = new Date('2026-09-05T18:29:59Z')
    expect(taskDueBy({ type: 'task', due_at: '2026-09-05T10:00:00Z', done_at: null }, eod)).toBe(true)
    expect(taskDueBy({ type: 'task', due_at: '2026-09-06T10:00:00Z', done_at: null }, eod)).toBe(false)
    expect(taskDueBy({ type: 'task', due_at: '2026-09-05T10:00:00Z', done_at: '2026-09-05T11:00:00Z' }, eod)).toBe(false)
    expect(taskDueBy({ type: 'call', due_at: '2026-09-05T10:00:00Z', done_at: null }, eod)).toBe(false)
  })
})

describe('sortTimeline', () => {
  it('orders newest first and keeps events ahead of activities at the same instant', () => {
    const out = sortTimeline([
      { kind: 'activity', at: '2026-09-05T10:00:00Z', id: 'a' },
      { kind: 'event', at: '2026-09-05T10:00:00Z', id: 'e' },
      { kind: 'activity', at: '2026-09-06T10:00:00Z', id: 'b' },
    ])
    expect(out.map((o) => o.id)).toEqual(['b', 'e', 'a'])
  })
})
