const MS_PER_MINUTE = 1000 * 60
const MS_PER_HOUR = MS_PER_MINUTE * 60
const MS_PER_DAY = MS_PER_HOUR * 24
const MS_PER_YEAR = MS_PER_DAY * 365

const pluralize = (value, unit) =>
  `${value.toLocaleString()} ${unit}${value === 1 ? '' : 's'}`

export function formatDuration(totalMs) {
  if (!totalMs || totalMs <= 0) return ''

  if (totalMs < MS_PER_HOUR) {
    return pluralize(Math.round(totalMs / MS_PER_MINUTE), 'minute')
  }

  if (totalMs < MS_PER_DAY) {
    return pluralize(Math.round(totalMs / MS_PER_HOUR), 'hour')
  }

  if (totalMs < MS_PER_YEAR) {
    const days = Math.floor(totalMs / MS_PER_DAY)
    let remainder = totalMs - days * MS_PER_DAY
    const hours = Math.floor(remainder / MS_PER_HOUR)
    remainder -= hours * MS_PER_HOUR
    const minutes = Math.round(remainder / MS_PER_MINUTE)
    const parts = [pluralize(days, 'day')]
    if (hours > 0) parts.push(pluralize(hours, 'hour'))
    if (minutes > 0) parts.push(pluralize(minutes, 'minute'))
    return parts.join(', ')
  }

  const years = Math.floor(totalMs / MS_PER_YEAR)
  let remainder = totalMs - years * MS_PER_YEAR
  const days = Math.floor(remainder / MS_PER_DAY)
  remainder -= days * MS_PER_DAY
  const hours = Math.floor(remainder / MS_PER_HOUR)
  remainder -= hours * MS_PER_HOUR
  const minutes = Math.round(remainder / MS_PER_MINUTE)
  const parts = [pluralize(years, 'year')]
  if (days > 0) parts.push(pluralize(days, 'day'))
  if (hours > 0) parts.push(pluralize(hours, 'hour'))
  if (minutes > 0) parts.push(pluralize(minutes, 'minute'))
  return parts.join(', ')
}
