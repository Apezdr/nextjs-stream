import { auth } from '@src/lib/auth'
import { redirect } from 'next/navigation'
import { withApprovedUser } from '@components/HOC/ApprovedUser'
import { adminUserEmails, siteTitle } from '@src/utils/config'
import DeletionRequestsAdmin from '@components/Admin/DeletionRequests/DeletionRequestsAdmin'

export const metadata = {
  title: `Deletion Requests - Admin - ${siteTitle}`,
  description: 'Manage account deletion requests and data privacy compliance',
}

async function DeletionRequestsAdminPage() {
  const session = await auth()

  if ((session && session.user && !adminUserEmails.includes(session.user.email)) || !session) {
    return redirect('/', 'replace')
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-between xl:p-8">
      <div className="h-auto flex flex-col items-center justify-center py-32 lg:py-0 sm:mt-20 w-full">
        <DeletionRequestsAdmin />
      </div>
    </div>
  )
}

export default withApprovedUser(DeletionRequestsAdminPage)