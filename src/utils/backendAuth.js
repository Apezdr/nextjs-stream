import { getSession } from '@src/lib/cachedAuth'

/**
 * Returns the Authorization header for Node backend requests.
 *
 * Strategy:
 * 1. If the client already sent Authorization: Bearer <token> (TV/device auth flow),
 *    forward it unchanged.
 * 2. Otherwise extract the token from the better-auth session (web/cookie clients).
 *
 * The returned object contains only the auth header — no Content-Type.
 * Callers spread it into their own headers object:
 *   const headers = { 'Content-Type': 'application/json', ...await getBackendAuthHeaders(request) }
 *
 * @param {Request} request - The incoming Next.js request
 * @returns {Promise<{ Authorization?: string }>}
 */
export async function getBackendAuthHeaders(request) {
  // Priority 1: pass through an existing Bearer token (TV / device auth clients)
  const authHeader = request.headers.get('authorization')
  if (authHeader?.startsWith('Bearer ')) {
    return { Authorization: authHeader }
  }

  // Priority 2: extract token from the server-side session (web / cookie clients)
  try {
    const session = await getSession()
    if (session?.session?.token) {
      return { Authorization: `Bearer ${session.session.token}` }
    }
    console.warn('[backendAuth] No session token available for backend authentication')
  } catch (error) {
    console.error('[backendAuth] Error getting session:', error)
  }

  return {}
}
