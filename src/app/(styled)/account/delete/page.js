import { redirect } from 'next/navigation'
import { withApprovedUser } from '@components/HOC/ApprovedUser'
import { siteTitle } from '@src/utils/config'
import AccountDeletionPage from './AccountDeletionPage'
import { getSession } from '@src/lib/cachedAuth'

export const metadata = {
  title: `Delete Account - ${siteTitle}`,
  description: 'Request deletion of your account and personal data',
}

async function DeleteAccountPage() {
  const session = await getSession();

  if (!session || !session.user) {
    return redirect('/auth/signin?callbackUrl=/account/delete')
  }

  return <AccountDeletionPage user={session.user} />
}

export default withApprovedUser(DeleteAccountPage)