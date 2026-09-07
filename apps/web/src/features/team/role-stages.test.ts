import { describe, expect, it } from 'vitest'
import { STAGE_ORDER, byStage, stageOf } from './role-stages'

const role = (type_name: string, stage: 'pre' | 'production' | 'post' | 'other' | null = null) => ({
  type_name,
  stage,
})

describe('stageOf', () => {
  it('takes the studio at its word when a stage is saved', () => {
    // Even when the name says otherwise: they renamed it for a reason.
    expect(stageOf(role('Candid Photographer', 'other'))).toBe('other')
  })

  it('reads the stage off the name when none was saved', () => {
    expect(stageOf(role('Candid Photographer'))).toBe('production')
    expect(stageOf(role('Drone Operator'))).toBe('production')
    expect(stageOf(role('Same Day Video Editor'))).toBe('post')
    expect(stageOf(role('Album Designer'))).toBe('post')
    expect(stageOf(role('Client Coordinator'))).toBe('pre')
    expect(stageOf(role('Operations Manager'))).toBe('other')
  })

  it('does not care about case or stray spacing', () => {
    expect(stageOf(role('  DRONE operator '))).toBe('production')
  })

  // "Album Designer" must not be caught by a looser pattern below it.
  it('lets the specific pattern win over the general one', () => {
    expect(stageOf(role('Album Designer'))).toBe('post')
    expect(stageOf(role('Photo Editor'))).toBe('post')
    expect(stageOf(role('Assistant Photographer'))).toBe('production')
  })

  it('files a role it cannot place under management', () => {
    expect(stageOf(role('Chai Wallah'))).toBe('other')
    expect(stageOf(role(''))).toBe('other')
  })
})

describe('byStage', () => {
  it('returns every stage in running order, empty ones included', () => {
    const groups = byStage([role('Cinematographer')])
    expect(groups.map((g) => g.stage)).toEqual([...STAGE_ORDER])
    expect(groups.find((g) => g.stage === 'production')?.roles).toHaveLength(1)
    expect(groups.find((g) => g.stage === 'post')?.roles).toEqual([])
  })

  it('keeps the order the roles arrived in inside a stage', () => {
    const groups = byStage([role('Video Editor'), role('Album Designer')])
    expect(groups.find((g) => g.stage === 'post')?.roles.map((r) => r.type_name)).toEqual([
      'Video Editor',
      'Album Designer',
    ])
  })

  it('puts every role somewhere, exactly once', () => {
    const roles = [role('Sales'), role('Drone Operator'), role('Photo Editor'), role('Chai Wallah')]
    const placed = byStage(roles).flatMap((g) => g.roles)
    expect(placed).toHaveLength(roles.length)
  })
})
