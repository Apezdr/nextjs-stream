import { resolveServerHealthSummary } from '@src/components/Admin/Stats/serverHealthSummary'

describe('server health summary precedence', () => {
  it('never hides a critical load behind an unavailable optional probe', () => {
    expect(resolveServerHealthSummary(100, true)).toBe('critical')
  })

  it.each([
    [60, true, 'moderate'],
    [0, true, 'unavailable'],
    [0, false, 'optimal'],
  ])('resolves metric %s / unavailable %s as %s', (metric, unavailable, expected) => {
    expect(resolveServerHealthSummary(metric, unavailable)).toBe(expected)
  })
})