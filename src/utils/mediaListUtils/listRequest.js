/**
 * A list page's filter, sort or page change, both ways: MovieListClient and
 * TVListClient send it as a GET's query (listSearchParams), and the routes
 * under /api/authenticated/media-list read it back (listRequestOptions) and
 * hand the cached fetch its arguments (listOptions).
 *
 * An array goes as one repeated key per value, so a value is never split.
 * No server-only import: the clients build their query from here.
 */

const strings = (value) => (Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [])

/** The query of a list request, from the client's filter state. */
export function listSearchParams({ page, sortOrder, genres, hdrTypes, resolutions } = {}) {
  const params = new URLSearchParams()
  if (page !== undefined && page !== null) params.set('page', String(page))
  if (typeof sortOrder === 'string') params.set('sortOrder', sortOrder)
  for (const [name, values] of [
    ['genres', genres],
    ['hdrTypes', hdrTypes],
    ['resolutions', resolutions],
  ]) {
    for (const value of strings(values)) params.append(name, value)
  }
  return params
}

/** The filter fields a list request's query carries, as sent. */
export function listRequestOptions(searchParams) {
  return {
    page: searchParams.get('page') ?? undefined,
    sortOrder: searchParams.get('sortOrder') ?? undefined,
    genres: searchParams.getAll('genres'),
    hdrTypes: searchParams.getAll('hdrTypes'),
    resolutions: searchParams.getAll('resolutions'),
  }
}

/**
 * The filter fields the list pages send, and nothing else: they are the cached
 * fetch's arguments, so its cache key too. Same keys, same order as the
 * page's own call (MovieListView/TVListView), so the two share cache entries.
 * `userId` and `scopeId` (the caller's library access id) come from the
 * caller's session, never from the request.
 */
export function listOptions({ page, sortOrder, genres, hdrTypes, resolutions } = {}, userId, scopeId) {
  return {
    page: Number.parseInt(page, 10) || undefined,
    sortOrder: typeof sortOrder === 'string' ? sortOrder : undefined,
    genres: strings(genres),
    hdrTypes: strings(hdrTypes),
    resolutions: strings(resolutions),
    userId,
    scopeId,
  }
}
