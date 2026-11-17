/**
 * The date strip's model: the day counts of
 * GET /api/authenticated/horizontal-list/timeline turned into months, and the
 * arithmetic between a place on the strip, a date and a position in the list.
 *
 * A position is a title's place in the Watch History list, 0 = most recent.
 * The days are counted from the same rows in the same order, so the titles
 * before a day add up to the position of that day's first title.
 *
 * The strip is a calendar: every month from this one back to the first has
 * the same width, empty months included. Inside a month, left to right runs
 * from its newest title to its oldest.
 */

const pad = (n) => String(n).padStart(2, '0')
const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

/** A calendar date as the timeline writes it, in local time. */
export const dateKey = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`

/**
 * @param {Array<[string, number]>} days - ['YYYY-MM-DD', count], newest first
 * @param {number} total - The length of the list
 * @param {Date} [today]
 * @returns {{ total: number, days: object[], months: object[] }}
 *   days: { date, year, month (0-11), day, count, start }
 *   months, newest first: { key, year, month, count, start, days }. An empty
 *   month's `start` is the position of the first title older than it.
 */
export function buildTimeline(days, total, today = new Date()) {
  const dayList = []
  const byMonth = new Map()
  let position = 0
  for (const [date, count] of days) {
    const entry = {
      date,
      year: Number(date.slice(0, 4)),
      month: Number(date.slice(5, 7)) - 1,
      day: Number(date.slice(8, 10)),
      count,
      start: position,
    }
    position += count
    dayList.push(entry)
    const key = date.slice(0, 7)
    if (!byMonth.has(key)) byMonth.set(key, [])
    byMonth.get(key).push(entry)
  }

  // From this month (or the newest day's, should a clock disagree) back to the oldest day's
  const newest = dayList[0]
  const oldest = dayList[dayList.length - 1]
  let year = today.getFullYear()
  let month = today.getMonth()
  if (newest && (newest.year > year || (newest.year === year && newest.month > month))) {
    year = newest.year
    month = newest.month
  }
  const lastYear = oldest ? oldest.year : year
  const lastMonth = oldest ? oldest.month : month

  const months = []
  let start = 0
  while (year > lastYear || (year === lastYear && month >= lastMonth)) {
    const key = `${year}-${pad(month + 1)}`
    const monthDays = byMonth.get(key) ?? []
    const count = monthDays.reduce((sum, day) => sum + day.count, 0)
    months.push({ key, year, month, count, start, days: monthDays })
    start += count
    month -= 1
    if (month < 0) {
      month = 11
      year -= 1
    }
  }

  return { total, days: dayList, months }
}

const lastPosition = (timeline) => Math.max(0, timeline.total - 1)

/** The month whose titles hold `position`; past the last dated title, the oldest month with any. */
export function monthIndexAt(timeline, position) {
  let lastWithTitles = 0
  for (let i = 0; i < timeline.months.length; i++) {
    const month = timeline.months[i]
    if (month.count === 0) continue
    if (position < month.start + month.count) return i
    lastWithTitles = i
  }
  return lastWithTitles
}

/** The day whose titles hold `position` (the oldest day past the end), or null with no days. */
export function dayAt(timeline, position) {
  const { days } = timeline
  if (days.length === 0) return null
  let low = 0
  let high = days.length - 1
  while (low < high) {
    const middle = (low + high) >> 1
    if (position < days[middle].start + days[middle].count) high = middle
    else low = middle + 1
  }
  return days[low]
}

/** Where a place on the strip (0 = today's edge, 1 = the oldest month's far edge) lands in the list. */
export function positionAtFraction(timeline, fraction) {
  const count = timeline.months.length
  const at = clamp(fraction, 0, 0.999999) * count
  const index = Math.min(count - 1, Math.floor(at))
  const month = timeline.months[index]
  if (month.count === 0) return Math.min(lastPosition(timeline), month.start)
  return month.start + Math.min(month.count - 1, Math.floor((at - index) * month.count))
}

/** The place on the strip of a position in the list. */
export function fractionAtPosition(timeline, position) {
  const index = monthIndexAt(timeline, position)
  const month = timeline.months[index]
  const within = month.count > 0 ? clamp((position - month.start) / month.count, 0, 1) : 0
  return (index + within) / timeline.months.length
}

/** The position of the first title watched `daysAgo` days ago or earlier (the last title when there is none). */
export function positionOfDaysAgo(timeline, daysAgo, today = new Date()) {
  const cutoff = dateKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() - daysAgo, 12))
  const day = timeline.days.find((entry) => entry.date <= cutoff)
  return day ? day.start : lastPosition(timeline)
}

/** The month to step to from the page starting at `first`: the next older one with titles, or the next newer. */
export function adjacentMonthPosition(timeline, first, older) {
  const { months } = timeline
  const index = monthIndexAt(timeline, first)
  if (older) {
    for (let i = index + 1; i < months.length; i++) if (months[i].count > 0) return months[i].start
    return lastPosition(timeline)
  }
  if (first > months[index].start) return months[index].start
  for (let i = index - 1; i >= 0; i--) if (months[i].count > 0) return months[i].start
  return 0
}

const noon = (entry) => new Date(entry.year, entry.month, entry.day, 12)

/**
 * The dates of the titles from position `first` to `last`, as a person says
 * them: "Today", "Nov 14, 2026", "Nov 14 – 16, 2026".
 */
export function describeRange(timeline, first, last, { today = new Date(), locale } = {}) {
  const newer = dayAt(timeline, first)
  const older = dayAt(timeline, Math.max(first, last))
  if (!newer || !older) return ''

  const format = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', year: 'numeric' })
  if (newer.date === older.date) {
    if (newer.date === dateKey(today)) return 'Today'
    if (newer.date === dateKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1, 12))) return 'Yesterday'
    return format.format(noon(newer))
  }
  return format.formatRange(noon(older), noon(newer))
}

/** The twelve month names in `locale`, January first. */
export function monthNames(locale, width = 'short') {
  const format = new Intl.DateTimeFormat(locale, { month: width })
  return Array.from({ length: 12 }, (_, month) => format.format(new Date(2021, month, 15, 12)))
}
