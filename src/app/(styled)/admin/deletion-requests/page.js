import { withApprovedUser } from '@components/HOC/ApprovedUser'
import { siteTitle } from '@src/utils/config'
import DeletionRequestsAdmin from '@components/Admin/DeletionRequests/DeletionRequestsAdmin'
import { adminGate } from '@src/lib/roles/gates'

export const metadata = {
  title: `Deletion Requests - Admin - ${siteTitle}`,
  description: 'Manage account deletion requests and data privacy compliance',
}

async function DeletionRequestsAdminPage() {
  await adminGate.page()


  return (
    <div className="flex min-h-screen flex-col items-center justify-between xl:p-8">
      <div className="h-auto flex flex-col items-center justify-center py-32 lg:py-0 sm:mt-20 w-full">
        <DeletionRequestsAdmin />
      </div>
    </div>
  )
}

export default withApprovedUser(DeletionRequestsAdminPage)