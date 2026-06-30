import { redirect } from 'next/navigation'
import { getSession } from '@src/lib/cachedAuth'

/**
 * Movie subtree layout — runs the approval check that used to live on the
 * `withApprovedUser` HOC around the now-replaced catch-all MediaPage.
 * Persists across child route navigations so the check happens once per
 * subtree visit.
 */
export default async function MovieSubtreeLayout({ children }) {
  const session = await getSession()
  if (session?.user && session.user.approved === false) {
    redirect('/auth/error?error=APPROVAL_PENDING')
  }

  return children
}
