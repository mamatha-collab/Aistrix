import { describe, expect, it } from 'vitest'
import { duration, pct, sortAlerts, usd } from './monitor'

describe('monitor formatting', () => {
  it('shows rates as percentages and missing values as a dash', () => {
    expect(pct(0.0476)).toBe('4.8%')
    expect(pct(1)).toBe('100%')
    expect(pct(null)).toBe('—')
  })
  it('shows response times in ms or seconds', () => {
    expect(duration(850)).toBe('850 ms')
    expect(duration(1450)).toBe('1.4 s')
    expect(duration(31000)).toBe('31 s')
    expect(duration(null)).toBe('—')
  })
  it('keeps small costs readable', () => {
    expect(usd(0.0031)).toBe('$0.0031')
    expect(usd(12.5)).toBe('$12.50')
    expect(usd(0)).toBe('$0.00')
    expect(usd(null)).toBe('—')
  })
  it('puts critical alerts first', () => {
    expect(sortAlerts([{ level: 'info' }, { level: 'critical' }, { level: 'warning' }]).map(a => a.level)).toEqual(['critical', 'warning', 'info'])
  })
})
