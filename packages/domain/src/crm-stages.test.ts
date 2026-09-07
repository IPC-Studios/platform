import { describe, expect, it } from 'vitest'
import { missingForStage, sortStages, stageForStatus, statusForStage, type StageLike } from './crm-stages'

const stage = (id: string, key: string, kind: StageLike['kind'], position: number): StageLike => ({
  id,
  key,
  name: key,
  kind,
  position,
})

const sales: StageLike[] = [
  stage('s1', 'new', 'open', 0),
  stage('s2', 'contacted', 'open', 1),
  stage('s3', 'qualified', 'open', 2),
  stage('s4', 'proposal_sent', 'open', 3),
  stage('s5', 'converted', 'won', 4),
  stage('s6', 'lost', 'lost', 5),
]

describe('statusForStage', () => {
  it('maps won and lost by kind, and legacy keys by name', () => {
    expect(statusForStage(sales[4]!, sales)).toBe('converted')
    expect(statusForStage(sales[5]!, sales)).toBe('lost')
    expect(statusForStage(sales[2]!, sales)).toBe('qualified')
  })

  it('maps a custom open stage by its rank, clamped to proposal_sent', () => {
    const custom = [stage('a', 'brief', 'open', 0), stage('b', 'shortlist', 'open', 1), stage('c', 'pitch', 'open', 2), stage('d', 'negotiation', 'open', 3), stage('e', 'final', 'open', 4), stage('w', 'won', 'won', 5), stage('l', 'lost', 'lost', 6)]
    expect(statusForStage(custom[0]!, custom)).toBe('new')
    expect(statusForStage(custom[1]!, custom)).toBe('contacted')
    expect(statusForStage(custom[3]!, custom)).toBe('proposal_sent')
    expect(statusForStage(custom[4]!, custom)).toBe('proposal_sent')
  })
})

describe('stageForStatus', () => {
  it('finds the stage by key, then by kind, then by rank', () => {
    expect(stageForStatus('qualified', sales)?.id).toBe('s3')
    const custom = [stage('a', 'brief', 'open', 0), stage('b', 'pitch', 'open', 1), stage('w', 'done', 'won', 2), stage('l', 'gone', 'lost', 3)]
    expect(stageForStatus('converted', custom)?.id).toBe('w')
    expect(stageForStatus('lost', custom)?.id).toBe('l')
    expect(stageForStatus('new', custom)?.id).toBe('a')
    expect(stageForStatus('proposal_sent', custom)?.id).toBe('b')
    expect(stageForStatus('new', [])).toBeNull()
  })
})

describe('sortStages', () => {
  it('orders by position and keeps the given order for ties', () => {
    expect(sortStages([stage('x', 'x', 'open', 2), stage('y', 'y', 'open', 0), stage('z', 'z', 'open', 2)]).map((s) => s.id)).toEqual(['y', 'x', 'z'])
  })
})

describe('missingForStage', () => {
  it('names the required fields a deal still lacks', () => {
    const deal = { deal_value: null, close_date: '2026-10-01', email: null, name: 'A', assigned_to: null, title: null, lost_reason: null }
    expect(missingForStage(['deal_value', 'close_date', 'email', 'name'], deal)).toEqual(['deal_value', 'email'])
    expect(missingForStage([], deal)).toEqual([])
  })
})
