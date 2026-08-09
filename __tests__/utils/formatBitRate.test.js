import { formatBytesAsBitRate } from '@src/utils/formatBitRate'

describe('formatBytesAsBitRate', () => {
  test.each([
    [0, '0 Kbps'],
    [2_000, '16.0 Kbps'],
    [2_000_000, '16.0 Mbps'],
    [200_000_000, '1.6 Gbps'],
    [null, '—'],
    [-1, '—'],
  ])('formats %p bytes per second as %s', (value, expected) => {
    expect(formatBytesAsBitRate(value)).toBe(expected)
  })
})