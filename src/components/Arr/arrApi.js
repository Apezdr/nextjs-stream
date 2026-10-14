// Browser side of /api/authenticated/arr. Every call throws ArrApiError with
// the server's own message on a non-2xx answer, which is written for people.

const BASE = '/api/authenticated/arr'

export class ArrApiError extends Error {
  constructor(message, status, body) {
    super(message)
    this.name = 'ArrApiError'
    this.status = status
    this.body = body
  }
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
  })
  let body = null
  try {
    body = await response.json()
  } catch {
    // Non-JSON (a proxy's error page): the status says enough.
  }
  if (!response.ok) {
    throw new ArrApiError(body?.message || `Request failed (HTTP ${response.status})`, response.status, body)
  }
  return body
}

export const fetchJson = (url) => request(url)

export const arrServiceName = (mediaType) => (mediaType === 'movie' ? 'Radarr' : 'Sonarr')

/**
 * Whether to offer this user the Radarr/Sonarr actions: admins only for now,
 * as the server's requireArrAccess() decides. The planned requester role
 * changes both together.
 */
export const canUseArr = (user) => user?.role === 'admin'

export const isArrMediaType = (mediaType) => mediaType === 'movie' || mediaType === 'tv'

export const arrKey = (item) => `${item.mediaType}:${item.tmdbId}`

// The display title helps Sonarr find a show its metadata has no TMDB link for.
function titleUrl(item, suffix = '') {
  const query = item.title ? `?title=${encodeURIComponent(item.title)}` : ''
  return `${BASE}/titles/${item.mediaType}/${item.tmdbId}${suffix}${query}`
}

export const fetchArrTitle = (item) => request(titleUrl(item))

export const addArrTitle = (item, body) => request(titleUrl(item), { method: 'POST', body: JSON.stringify(body) })

export const updateArrTitle = (item, body) => request(titleUrl(item), { method: 'PATCH', body: JSON.stringify(body) })

export const searchArrTitle = (item, scope) =>
  request(titleUrl(item, '/search'), { method: 'POST', body: JSON.stringify({ scope }) })

export const fetchArrEpisodes = (item) => request(titleUrl(item, '/episodes'))

/** Starts the service's interactive search: a movie (target null), or a show's { seasonNumber } or { episodeId }. */
export const startReleaseSearch = (item, target) =>
  request(titleUrl(item, '/releases'), { method: 'POST', body: JSON.stringify(target ?? {}) })

export const fetchReleaseSearch = (searchId) => request(`${BASE}/releases/${searchId}`)

export const grabRelease = (searchId, releaseId) =>
  request(`${BASE}/releases/${searchId}/grab`, { method: 'POST', body: JSON.stringify({ releaseId }) })

/** Matches the route's MAX_STATUS_ITEMS. */
const MAX_STATUS_ITEMS = 200

/** The status URL for a page of items, or null when none can be in Radarr/Sonarr. */
export function arrStatusUrl(items) {
  const keys = new Set()
  for (const item of items ?? []) {
    const tmdbId = Number(item?.tmdbId)
    if (isArrMediaType(item?.mediaType) && Number.isSafeInteger(tmdbId) && tmdbId > 0) {
      keys.add(`${item.mediaType}:${tmdbId}`)
    }
  }
  if (keys.size === 0) return null
  // Sorted, so the same page always asks with the same URL (one SWR key).
  const list = [...keys].sort().slice(0, MAX_STATUS_ITEMS)
  return `${BASE}/status?items=${list.join(',')}`
}
