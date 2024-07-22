import { auth } from '../../lib/auth'
import { redirect } from 'next/navigation'

export const withApprovedUser = (WrappedComponent) => {
  return async function ApprovedUserComponent(props) {
    const session = await auth()

    // Redirect if not signed in or not approved
    if (session && session.user?.approved == false) {
      redirect('/auth/error?error=APPROVAL_PENDING')
    }

    return <WrappedComponent {...props} />
  }
}
