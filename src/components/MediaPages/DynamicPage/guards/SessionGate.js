/**
 * Session Gate
 *
 * The signed-in, approved-account check for a media page, done INSIDE the
 * page's Suspense boundary instead of at the top of the page or in a layout.
 *
 * Why it lives here: anything a page or layout awaits at its top level is
 * absent from the route's prerendered shell, and the shell is what a link can
 * have ready before the click. Reading the URL params and the session up there
 * left every media route with an empty shell. Render this as the only child of
 * the page's <Suspense fallback={<…Skeleton />}> and the skeleton becomes the
 * shell while the gate resolves.
 *
 * SECURITY: nothing protected is rendered or fetched until the session is
 * confirmed on the server. `children` is a function so the page's content
 * element is not even created for a visitor who fails the gate:
 * - approved === false  -> redirected to the approval-pending page (the check
 *   the tv/ and movie/ subtree layouts used to run)
 * - no session          -> the sign-in page (AuthGuard)
 * Do not hoist data fetching above this gate.
 *
 * Server component.
 *
 * @param {Object} props
 * @param {Promise<Object>} [props.params] - the page's params promise, awaited here
 * @param {(params: Object) => string} props.callbackUrl - where sign-in returns to
 * @param {(ctx: { session: Object, params: Object }) => React.ReactNode} props.children
 */

import { redirect } from 'next/navigation'
import { cacheLife } from 'next/cache'
import { getSession } from '@src/lib/cachedAuth'
import AuthGuard from './AuthGuard'

/**
 * How long the BROWSER may reuse a gated page it has already been sent, in
 * seconds. 30 is the floor: below it Next leaves the output out of a link's
 * prefetch altogether ("a prefetch would expire before the user could click").
 */
const GATE_STALE_SECONDS = 30

/**
 * The session as the gate needs it, with a cache lifetime.
 *
 * Without a lifetime the session lookup is an uncached read, and a prefetch
 * stops at the first one: <Link prefetch> could never carry anything past the
 * page skeleton. 'use cache: private' gives it a lifetime WITHOUT sharing it:
 * - Nothing is stored on the server between requests. Every request that
 *   reaches the server, including every prefetch, runs the real session check
 *   again against the database.
 * - Only the browser's router may keep the rendered result, in memory, for
 *   GATE_STALE_SECONDS, and only for the person it was rendered for.
 * So the most a revoked or newly limited account can do is re-show, for up to
 * 30 seconds, an info page its own browser had already received. Before this
 * a fully prefetched page was reusable for 5 minutes (staleTimes.static).
 * Playback and every API route still check live and are not touched by this.
 *
 * Returns plain data (no Dates, no provider objects): a cached result has to
 * serialize, and the gate only needs these fields.
 */
async function getGateSession() {
  'use cache: private'
  cacheLife({ stale: GATE_STALE_SECONDS })

  const session = await getSession()
  if (!session?.user) return null
  const { id, approved, limitedAccess } = session.user
  return { user: { id, approved, limitedAccess: !!limitedAccess } }
}

export default async function SessionGate({ params, callbackUrl, children }) {
  const resolvedParams = params ? await params : {}
  const session = await getGateSession()

  if (session?.user && session.user.approved === false) {
    redirect('/auth/error?error=APPROVAL_PENDING')
  }

  return (
    <AuthGuard session={session} callbackUrl={callbackUrl(resolvedParams)} variant="skeleton">
      {session?.user ? children({ session, params: resolvedParams }) : null}
    </AuthGuard>
  )
}
