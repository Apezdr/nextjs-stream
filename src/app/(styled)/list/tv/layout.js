import { redirect } from 'next/navigation'
import { getSession } from '@src/lib/cachedAuth'

/**
 * TV subtree layout — runs the approval check that used to live on the
 * `withApprovedUser` HOC around the now-replaced catch-all MediaPage.
 * Mirrors the movie subtree layout.
 */
export default async function TVSubtreeLayout({ children }) {
  const session = await getSession()
  if (session?.user && session.user.approved === false) {
    redirect('/auth/error?error=APPROVAL_PENDING')
  }

  return children
}
