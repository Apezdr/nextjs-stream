/**
 * The client's one implementation of ETag revalidation.
 *
 * The polled routes send a weak ETag and answer a matching If-None-Match with
 * a bodiless 304 (see src/utils/cache/etagHelpers.js). This keeps each URL's
 * last ETag and body, sends If-None-Match on the next GET, and hands the kept
 * body back on a 304. It is shared by everything in the tab, so components
 * polling the same URL revalidate against one copy.
 *
 * It does not lean on the browser's HTTP cache: a request that sets its own
 * If-None-Match bypasses that cache (Fetch spec), so the 304 reaches this code
 * and behaves the same in every browser mode.
 */

// Room for every URL a page polls, plus paging; the least recently used go first
const MAX_ENTRIES = 100
const validators = new Map()

function remember(url, entry) {
  validators.delete(url)
  validators.set(url, entry)
  if (validators.size > MAX_ENTRIES) {
    validators.delete(validators.keys().next().value)
  }
}

/**
 * fetch() with If-None-Match revalidation for GETs.
 *
 * @param {string} url
 * @param {Object} [options] - fetch options, plus `seed`: an `{ etag, data }`
 *   pair already on screen (from the server render), used only while nothing
 *   is kept for the URL, so the first request can already be a 304
 * @returns {Promise<{ response: Response, data: any, notModified: boolean }>}
 *   `data` is the parsed JSON body, the kept copy on a 304, or undefined when
 *   the response is not ok (the caller decides what an error means)
 */
export async function fetchWithETag(url, { seed, ...init } = {}) {
  const conditional = (init.method || 'GET').toUpperCase() === 'GET'
  if (conditional && seed?.etag && !validators.has(url)) {
    remember(url, { etag: seed.etag, data: seed.data })
  }
  const cached = conditional ? validators.get(url) : undefined

  const headers = new Headers(init.headers)
  if (cached) headers.set('If-None-Match', cached.etag)
  const response = await fetch(url, { ...init, headers })

  if (response.status === 304 && cached) {
    remember(url, cached)
    return { response, data: cached.data, notModified: true }
  }
  if (!response.ok) {
    return { response, data: undefined, notModified: false }
  }

  const data = await response.json()
  if (conditional) {
    const etag = response.headers.get('ETag')
    if (etag) remember(url, { etag, data })
    else validators.delete(url)
  }
  return { response, data, notModified: false }
}
