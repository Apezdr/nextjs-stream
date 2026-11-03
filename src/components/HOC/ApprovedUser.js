import { getSession } from '@src/lib/cachedAuth'
import { redirect } from 'next/navigation'
import { isAwaitingApproval } from '@src/lib/roles/rules'

export const withApprovedUser = (WrappedComponent) => {
  return async function ApprovedUserComponent(props) {
    const session = await getSession();

    // Redirect if not signed in or not approved
    if (isAwaitingApproval(session?.user)) {
      redirect('/auth/error?error=APPROVAL_PENDING')
    }

    return <WrappedComponent {...props} />
  }
}
