// Allow-list for forward-auth login redirects (/api/authz/verify -> /auth/signin).
// Kept dependency-free so src/lib/auth.ts can import it at better-auth init without
// pulling in the server-manager graph behind src/utils/config.js.

function parseEntries(raw) {
  if (!raw) return []
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .flatMap((entry) => {
      try {
        const url = new URL(entry)
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return []
        return [url]
      } catch {
        return []
      }
    })
}

// Each entry may be a bare origin or an origin+path prefix (Organizr is often
// reverse-proxied under a subpath rather than its own subdomain).
export const gatedAuthOrigins = parseEntries(process.env.GATED_AUTH_ORIGINS)

// Origins only (no paths), deduplicated — the shape better-auth's trustedOrigins wants
// so the social sign-in flow accepts a callbackURL pointing back at a gated app.
export const gatedAuthTrustedOrigins = [...new Set(gatedAuthOrigins.map((url) => url.origin))]

/**
 * True when `candidate` sits inside one of the allow-listed entries.
 * Compares origin exactly and path by segment prefix — a plain string
 * `startsWith` would let `https://app.example.com.evil.com` through.
 */
export function isGatedAuthUrl(candidate, entries = gatedAuthOrigins) {
  let url
  try {
    url = candidate instanceof URL ? candidate : new URL(candidate)
  } catch {
    return false
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false

  return entries.some((entry) => {
    if (url.origin !== entry.origin) return false
    const prefix = entry.pathname.replace(/\/+$/, '')
    if (!prefix) return true
    return url.pathname === prefix || url.pathname.startsWith(`${prefix}/`)
  })
}
