import { describe, expect, it } from 'vitest'
import {
  areaPath,
  groupBy,
  linePath,
  monthlySeries,
  scaleFor,
  shareOf,
  trendPercent,
} from './chart-geometry'

describe('scaleFor', () => {
  it('runs from zero to the largest value, with headroom', () => {
    const s = scaleFor([10, 40, 25])
    expect(s.max).toBeCloseTo(42)
    expect(s.percent(40)).toBeCloseTo(95.2, 0)
    expect(s.percent(0)).toBe(0)
  })

  it('survives an all-zero series instead of dividing by it', () => {
    const s = scaleFor([0, 0, 0])
    expect(s.max).toBe(1)
    expect(s.percent(0)).toBe(0)
    expect(Number.isNaN(s.percent(0))).toBe(false)
  })

  it('survives an empty series', () => {
    expect(scaleFor([]).max).toBe(1)
  })

  it('clamps a negative value to the baseline rather than inverting the axis', () => {
    // A loss is worth showing, but not as a bar growing downward out of view.
    const s = scaleFor([100, -50])
    expect(s.percent(-50)).toBe(0)
  })

  it('never exceeds full height', () => {
    const s = scaleFor([10])
    expect(s.percent(1000)).toBe(100)
  })
})

describe('linePath', () => {
  it('flips y, because SVG counts down and a chart counts up', () => {
    // The single most common way a sparkline ends up upside down.
    const values = [0, 100]
    const path = linePath(values, scaleFor(values, 1))
    expect(path).toBe('M 0.00 100.00 L 100.00 0.00')
  })

  it('spreads points evenly across the full width', () => {
    const path = linePath([1, 1, 1], scaleFor([1, 1, 1]))
    expect(path).toContain('M 0.00')
    expect(path).toContain('L 50.00')
    expect(path).toContain('L 100.00')
  })

  it('draws a flat line for a single point rather than nothing', () => {
    expect(linePath([5], scaleFor([5]))).toMatch(/^M 0 .* L 100 /)
  })

  it('is empty with no points at all', () => {
    expect(linePath([], scaleFor([]))).toBe('')
    expect(areaPath([], scaleFor([]))).toBe('')
  })
})

describe('areaPath', () => {
  it('closes the line down to the baseline', () => {
    const values = [10, 20]
    expect(areaPath(values, scaleFor(values))).toMatch(/L 100 100 L 0 100 Z$/)
  })
})

describe('trendPercent', () => {
  it('measures first to last', () => {
    expect(trendPercent([100, 150])).toBe(50)
    expect(trendPercent([200, 100])).toBe(-50)
  })

  it('says nothing when there is nothing honest to say', () => {
    // "Up ∞%" from zero is not a fact worth printing.
    expect(trendPercent([0, 500])).toBeNull()
    expect(trendPercent([100])).toBeNull()
    expect(trendPercent([])).toBeNull()
  })
})

describe('shareOf', () => {
  const points = [
    { label: 'Gear', value: 50 },
    { label: 'Travel', value: 30 },
    { label: 'Food', value: 18 },
    { label: 'Misc', value: 1 },
    { label: 'Stamps', value: 1 },
  ]

  it('sorts by share, largest first', () => {
    const slices = shareOf(points)
    expect(slices[0]!.label).toBe('Gear')
    expect(slices[0]!.percent).toBe(50)
  })

  it('groups slivers into one honest Other', () => {
    // A dozen 1% slices cannot be labelled or matched to a legend.
    const slices = shareOf(points)
    expect(slices.map((s) => s.label)).toEqual(['Gear', 'Travel', 'Food', 'Other (2)'])
    expect(slices[3]!.value).toBe(2)
  })

  it('adds up to 100', () => {
    const total = shareOf(points).reduce((sum, s) => sum + s.percent, 0)
    expect(Math.round(total)).toBe(100)
  })

  it('ignores zero and negative values, and an empty set', () => {
    expect(shareOf([{ label: 'a', value: 0 }])).toEqual([])
    expect(shareOf([{ label: 'a', value: -5 }])).toEqual([])
    expect(shareOf([])).toEqual([])
  })
})

describe('monthlySeries', () => {
  const TODAY = new Date(2026, 8, 15) // 15 Sep 2026
  const rows = [
    { on: '2026-09-01', amount: 100 },
    { on: '2026-09-28', amount: 50 },
    { on: '2026-07-04', amount: 30 },
    { on: '2025-09-04', amount: 999 }, // a year ago, outside the window
    { on: null, amount: 7 },
  ]
  const series = () => monthlySeries(rows, (r) => r.on, (r) => r.amount, 4, TODAY)

  it('buckets into the last N months, oldest first', () => {
    expect(series().map((p) => p.label)).toEqual(['Jun', 'Jul', 'Aug', 'Sep'])
  })

  it('sums within a month and keeps empty months', () => {
    // A gap is information: a month with no invoices should read as zero.
    expect(series().map((p) => p.value)).toEqual([0, 30, 0, 150])
  })

  it('ignores anything outside the window, or with no date', () => {
    expect(series().reduce((sum, p) => sum + p.value, 0)).toBe(180)
  })

  it('reads the month from the string, not from a parsed Date', () => {
    // new Date('2026-09-01') is midnight UTC — still August in a negative
    // offset, which would move a month's takings into the previous month.
    const first = monthlySeries([{ on: '2026-09-01', amount: 5 }], (r) => r.on, (r) => r.amount, 2, TODAY)
    expect(first[1]).toEqual({ label: 'Sep', value: 5 })
  })

  it('crosses a year boundary', () => {
    const january = new Date(2027, 0, 10)
    const s = monthlySeries([{ on: '2026-12-20', amount: 9 }], (r) => r.on, (r) => r.amount, 2, january)
    expect(s.map((p) => p.label)).toEqual(['Dec', 'Jan'])
    expect(s[0]!.value).toBe(9)
  })
})

describe('groupBy', () => {
  it('sums by key and names the unlabelled', () => {
    const points = groupBy(
      [
        { cat: 'Gear', amount: 10 },
        { cat: 'Gear', amount: 5 },
        { cat: null, amount: 2 },
        { cat: '   ', amount: 1 },
      ],
      (r) => r.cat,
      (r) => r.amount,
    )
    expect(points).toContainEqual({ label: 'Gear', value: 15 })
    expect(points).toContainEqual({ label: 'Uncategorised', value: 3 })
  })
})
