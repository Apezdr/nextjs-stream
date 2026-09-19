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
import { getSession } from '@src/lib/cachedAuth'
import AuthGuard from './AuthGuard'

export default async function SessionGate({ params, callbackUrl, children }) {
  const resolvedParams = params ? await params : {}
  const session = await getSession()

  if (session?.user && session.user.approved === false) {
    redirect('/auth/error?error=APPROVAL_PENDING')
  }

  return (
    <AuthGuard session={session} callbackUrl={callbackUrl(resolvedParams)} variant="skeleton">
      {session?.user ? children({ session, params: resolvedParams }) : null}
    </AuthGuard>
  )
}
