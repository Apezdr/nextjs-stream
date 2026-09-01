// Session-cookie names and the bearer-precedence guard used by the proxy.
// Kept out of proxy.ts so it can be unit-tested without pulling in
// `next/server` (which needs edge-runtime globals).

// All known cookie prefixes — includes legacy 'better-auth' default and
// the current 'nextjs-stream' prefix so users migrating from either are covered.
export const COOKIE_PREFIXES = ['better-auth', 'nextjs-stream']

export const AUTH_COOKIE_NAMES = COOKIE_PREFIXES.flatMap((prefix) => [
  `${prefix}.session_token`,
  `${prefix}.session_data`,
  `${prefix}.dont_remember`,
  `__Secure-${prefix}.session_token`,
  `__Secure-${prefix}.session_data`,
  `__Secure-${prefix}.dont_remember`,
])

const AUTH_COOKIE_NAME_SET = new Set(AUTH_COOKIE_NAMES)

/**
 * Remove better-auth's session cookies from a Cookie header value, leaving
 * every other cookie untouched. Returns null when nothing is left to send.
 */
export function stripAuthCookies(cookieHeader: string): string | null {
  const kept = cookieHeader
    .split(';')
    .filter((pair) => {
      const eq = pair.indexOf('=')
      const name = (eq === -1 ? pair : pair.slice(0, eq)).trim()
      return !AUTH_COOKIE_NAME_SET.has(name)
    })
    .map((pair) => pair.trim())
    .filter(Boolean)

  return kept.length ? kept.join('; ') : null
}
