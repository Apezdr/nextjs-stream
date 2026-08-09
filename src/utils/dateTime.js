export const DEFAULT_APP_TIME_ZONE = 'America/New_York'

const formatterCache = new Map()

export function normalizeTimeZone(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 64) return null
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: value.trim() })
      .resolvedOptions().timeZone
  } catch {
    return null
  }
}

export function formatDateTime(value, timeZone = DEFAULT_APP_TIME_ZONE, options = {}) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  const normalizedTimeZone = normalizeTimeZone(timeZone) || DEFAULT_APP_TIME_ZONE
  const resolvedOptions = {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
    ...options,
    timeZone: normalizedTimeZone,
  }
  const cacheKey = `${normalizedTimeZone}:${JSON.stringify(resolvedOptions)}`
  let formatter = formatterCache.get(cacheKey)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', resolvedOptions)
    formatterCache.set(cacheKey, formatter)
  }
  return formatter.format(date)
}

export function formatDateOnly(value, timeZone = DEFAULT_APP_TIME_ZONE, options = {}) {
  return formatDateTime(value, timeZone, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: undefined,
    minute: undefined,
    second: undefined,
    hour12: undefined,
    ...options,
  })
}