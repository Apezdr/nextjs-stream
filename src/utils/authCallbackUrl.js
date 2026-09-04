const DEFAULT_CALLBACK_PATH = '/list'

function normalizeFallbackPath(fallbackPath) {
  if (typeof fallbackPath !== 'string') return DEFAULT_CALLBACK_PATH
  const trimmed = fallbackPath.trim()
  if (!trimmed) return DEFAULT_CALLBACK_PATH
  return trimmed
}

/**
 * Better Auth is strict about allowed characters in relative callback paths.
 * Converting callback URLs to absolute URLs avoids false negatives for encoded
 * route segments like `%20` in media titles.
 */
export function normalizeAuthCallbackURL(callbackUrl, fallbackPath = DEFAULT_CALLBACK_PATH) {
  const normalizedFallbackPath = normalizeFallbackPath(fallbackPath)
  const normalizedCallback = typeof callbackUrl === 'string' ? callbackUrl.trim() : ''
  const candidate = normalizedCallback || normalizedFallbackPath

  if (typeof window === 'undefined') {
    return candidate
  }

  try {
    return new URL(candidate, window.location.origin).toString()
  } catch {
    return new URL(normalizedFallbackPath, window.location.origin).toString()
  }
}

/**
 * Server-side resolver for the `?callbackUrl=` a sign-in page receives.
 * Accepts a same-site path, or an absolute URL inside the forward-auth allow-list;
 * anything else (open-redirect attempts included) collapses to the fallback.
 * `isAllowedExternal` is injected so this module stays free of env reads.
 */
export function resolveSignInCallback(
  rawCallbackUrl,
  { isAllowedExternal, fallbackPath = DEFAULT_CALLBACK_PATH } = {}
) {
  const fallback = { callbackUrl: normalizeFallbackPath(fallbackPath), isExternal: false, destinationHost: null }
  const candidate = typeof rawCallbackUrl === 'string' ? rawCallbackUrl.trim() : ''
  if (!candidate) return fallback

  // Same-site path: a single leading slash. `//host` and `/\host` are
  // protocol-relative and would leave the site, so they are not paths here.
  if (candidate.startsWith('/')) {
    if (/^\/[\\/]/.test(candidate)) return fallback
    return { callbackUrl: candidate, isExternal: false, destinationHost: null }
  }

  let url
  try {
    url = new URL(candidate)
  } catch {
    return fallback
  }
  if (typeof isAllowedExternal !== 'function' || !isAllowedExternal(url)) return fallback

  return { callbackUrl: url.toString(), isExternal: true, destinationHost: url.host }
}