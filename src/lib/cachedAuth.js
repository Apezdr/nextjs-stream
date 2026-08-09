import { cache } from 'react'
import { auth } from '@src/lib/auth'
import { headers } from 'next/headers'
import { getLocalOwnerSession } from '@src/lib/localOwnerSession'

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

  const sessionPromise = resolveSession(requestHeaders)
  sessionByRequest.set(requestHeaders, sessionPromise)
  return sessionPromise
})

/**
 * A real session always wins. Local owner access is only consulted when the
 * request carries no session at all, so it can never upgrade or replace the
 * identity of someone who is already signed in.
 */
async function resolveSession(requestHeaders) {
  const session = await auth.api.getSession({ headers: requestHeaders })
  if (session?.user) return session
  return getLocalOwnerSession(requestHeaders)
}
