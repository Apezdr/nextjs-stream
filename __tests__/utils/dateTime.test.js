import { formatDateTime, normalizeTimeZone } from '@src/utils/dateTime'

test('formats winter and summer instants with IANA daylight-saving rules', () => {
  expect(formatDateTime('2024-01-15T17:00:00.000Z', 'America/New_York')).toBe('01/15/2024, 12:00:00 PM')
  expect(formatDateTime('2024-07-15T16:00:00.000Z', 'America/New_York')).toBe('07/15/2024, 12:00:00 PM')
})

test('normalizes valid zones and rejects invalid zones', () => {
  expect(normalizeTimeZone(' America/New_York ')).toBe('America/New_York')
  expect(normalizeTimeZone('Not/AZone')).toBeNull()
  expect(formatDateTime('not-a-date', 'UTC')).toBe('—')
})