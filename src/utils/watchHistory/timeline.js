/**
 * How many titles a viewer last watched on each calendar day: the numbers
 * behind the Watch History row's date strip and its month and day picker
 * (GET /api/authenticated/horizontal-list/timeline).
 *
 * It counts the rows the row itself lists, in the order it lists them
 * (getFlatRecentlyWatchedForUser: not flagged invalid, newest `lastUpdated`
 * first). So the days before a day add up to the list position of that day's
 * first title, and a date is turned into a page of the row by that sum alone.
 * A change to the row's filter or order belongs here too.
 *
 * A day is the viewer's own: 11 pm in New York is 4 am the next day in UTC,
 * so the caller names its time zone.
 */

import { findPlaybackForUser } from '@src/utils/watchHistory/database'

/**
 * Whether `value` is a time zone this runtime can count days in.
 * @param {unknown} value
 * @returns {boolean}
 */
export function isTimeZone(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 64) return false
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: value })
    return true
  } catch {
    return false
  }
}

/**
 * The viewer's history counted by day, newest day first.
 *
 * `total` is every row the list holds. It is larger than the sum of `days`
 * only when rows carry no date: those sort last in the list, after every day.
 *
 * @param {string|import('mongodb').ObjectId} userId
 * @param {string} timeZone - An IANA zone (isTimeZone)
 * @returns {Promise<{ total: number, days: Array<[string, number]> }>} days as ['YYYY-MM-DD', count]
 */
export async function readWatchDays(userId, timeZone) {
  const rows = await findPlaybackForUser(userId, {
    filter: { isValid: { $ne: false } },
    projection: { _id: 0, lastUpdated: 1 },
    sort: { lastUpdated: -1 },
  })

  // en-CA writes a date as YYYY-MM-DD
  const dayOf = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
  const days = []
  for (const row of rows) {
    if (row.lastUpdated == null) continue
    const at = row.lastUpdated instanceof Date ? row.lastUpdated : new Date(row.lastUpdated)
    if (Number.isNaN(at.getTime())) continue

    const day = dayOf.format(at)
    const last = days[days.length - 1]
    if (last && last[0] === day) last[1] += 1
    else days.push([day, 1])
  }

  return { total: rows.length, days }
}
