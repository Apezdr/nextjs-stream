import { getSession } from '@src/lib/cachedAuth'
import { redirect } from 'next/navigation'

export const withApprovedUser = (WrappedComponent) => {
  return async function ApprovedUserComponent(props) {
    const session = await getSession();

    // Redirect if not signed in or not approved
    if (session?.user && session.user.approved === false) {
      redirect('/auth/error?error=APPROVAL_PENDING')
    }

    return <WrappedComponent {...props} />
  }
}
