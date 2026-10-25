import { cache } from 'react'
import { cacheLife } from 'next/cache'
import { auth } from '@src/lib/auth'
import { headers } from 'next/headers'

/**
 * Request-scoped session store. React's cache() only memoizes during RSC
 * rendering — in Route Handlers it is a passthrough (no cache dispatcher is
 * installed), which previously meant every getSession() call re-queried the
 * session + user from Mongo (dozens of times on helper-heavy requests).
 *
 * Next's headers() resolves to the same underlying object for every call
 * within one request (per-request cached promise in
 * next/dist/server/request/headers.js — the same WeakMap-on-headers pattern
 * used here), and different requests get different objects, so keying on it
 * cannot leak sessions across requests. Entries are GC'd with the request.
 */
const sessionByRequest = new WeakMap()

/**
 * Request-level cached auth function.
 * Deduplicates multiple getSession() calls within a single server request —
 * via React cache() inside RSC renders, and via the per-request WeakMap in
 * Route Handlers. The PROMISE is memoized, so concurrent callers racing
 * before the first lookup resolves still share one auth query.
 * All server code should import this instead of calling auth.api.getSession() directly.
 */
export const getSession = cache(async () => {
  const requestHeaders = await headers()

  const memoized = sessionByRequest.get(requestHeaders)
  if (memoized) {
    return memoized
  }

  const sessionPromise = auth.api.getSession({ headers: requestHeaders })
  sessionByRequest.set(requestHeaders, sessionPromise)
  return sessionPromise
})

/** How long the browser may reuse chrome rendered from getChromeSession(), in seconds (the prefetch floor). */
const CHROME_STALE_SECONDS = 30

/**
 * The session as page chrome needs it (the nav bar, the TV apps notice, the
 * footer), with a lifetime, so the chrome can ride a prefetch.
 *
 * Partial prefetching prerenders the /list routes with the request's cookies,
 * and getSession() reads the current time inside better-auth's expiry check,
 * which a prerender may not: navigating to a title page raised "Blocking Route
 * ... unstable value new Date()" in dev. 'use cache: private', as the page
 * gate's session does (guards/SessionGate.js): nothing is stored on the server
 * and every request checks the session again; only the browser may reuse the
 * result, for CHROME_STALE_SECONDS. It decides only what chrome to show: every
 * page runs its own gate, and every API route checks live.
 *
 * Returns plain fields (a cached result has to serialize), or null when signed out.
 */
export async function getChromeSession() {
  'use cache: private'
  cacheLife({ stale: CHROME_STALE_SECONDS })

  const session = await getSession()
  if (!session?.user) return null
  const { id, email, image, role, approved, preferences } = session.user
  return {
    id,
    email: email ?? null,
    image: image ?? null,
    isAdmin: role === 'admin',
    approved: approved !== false,
    tvAppsNotificationDismissed: Boolean(preferences?.tvAppsNotificationDismissed),
  }
}
