import 'server-only'
import { redirect } from 'next/navigation'
import { getSession } from '@src/lib/cachedAuth'

/**
 * The caller of a Server Action that serves a media page's data, checked as
 * the page's SessionGate checks it: signed in, and not awaiting approval.
 *
 * A page's gate doesn't cover the actions it renders: each exported
 * 'use server' function is its own POST endpoint, and the list pages' client
 * chunks carry their actions' IDs. So the action checks its caller itself, and
 * takes the user from the session, never from its arguments.
 *
 * Redirects where the page would send the caller (redirect() works inside a
 * Server Action: the client navigates): to sign-in, back to callbackUrl
 * afterwards, or to the approval-pending page. Call it outside any try/catch:
 * redirect() throws.
 */
export async function requireApprovedViewer(callbackUrl: string) {
  const session = await getSession()
  const user = session?.user
  if (!user) redirect(`/auth/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`)
  if (user.approved === false) redirect('/auth/error?error=APPROVAL_PENDING')
  return user
}
