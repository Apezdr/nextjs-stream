/**
 * Which failed TMDB requests are worth another try. One rule for the server's
 * backend client (backendClient.js) and the browser's proxy client
 * (client.js), which can't import the former: it pulls in got and Redis.
 */

// Statuses another try can fix: rate limited (429), overloaded (503), timed
// out behind a proxy (504). Not a 4xx such as a title TMDB doesn't have, not a
// 502 (the media processor has already retried TMDB itself) and not a 500 (a
// bug that fails the same way every time).
const RETRYABLE_STATUSES = new Set([429, 503, 504])

/**
 * @param {number|null|undefined} status - The failed request's HTTP status;
 *   none when it got no answer at all (unreachable, timed out)
 * @returns {boolean}
 */
export function isRetryableTmdbStatus(status) {
  // No error status: no answer at all, or one that broke off mid-body
  if (!Number.isInteger(status) || status < 400) return true
  return RETRYABLE_STATUSES.has(status)
}
