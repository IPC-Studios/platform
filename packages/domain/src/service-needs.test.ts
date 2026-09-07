import { describe, expect, it } from 'vitest'
import { mergeServiceNeeds } from './service-needs'

describe('mergeServiceNeeds', () => {
  it('adds quantities for the same service spelled differently', () => {
    expect(
      mergeServiceNeeds([
        { name: 'Drone pilot', quantity: 2 },
        { name: '  drone PILOT ', quantity: 1 },
        { name: 'Photographer', quantity: 1 },
      ]),
    ).toEqual([
      { name: 'Drone pilot', quantity: 3 },
      { name: 'Photographer', quantity: 1 },
    ])
  })

  it('drops blank names and keeps first-seen casing', () => {
    expect(mergeServiceNeeds([{ name: '   ', quantity: 1 }, { name: 'Gaffer', quantity: 1 }])).toEqual([
      { name: 'Gaffer', quantity: 1 },
    ])
  })

  it('returns nothing for nothing', () => {
    expect(mergeServiceNeeds([])).toEqual([])
  })
})
