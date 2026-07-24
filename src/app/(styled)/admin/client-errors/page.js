import { redirect } from 'next/navigation'
import { withApprovedUser } from '@components/HOC/ApprovedUser'
import { adminUserEmails, siteTitle } from '@src/utils/config'
import ClientErrorsAdmin from '@components/Admin/ClientErrors/ClientErrorsAdmin'
import { getSession } from '@src/lib/cachedAuth'

export const metadata = {
  title: `Client Errors - Admin - ${siteTitle}`,
  description: 'Aggregated error reports from external client apps',
}

async function ClientErrorsAdminPage() {
  const session = await getSession()

  if ((session && session.user && !adminUserEmails.includes(session.user.email)) || !session) {
    return redirect('/', 'replace')
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-between xl:p-8">
      <div className="h-auto flex flex-col items-center justify-center py-32 lg:py-0 sm:mt-20 w-full">
        <ClientErrorsAdmin />
      </div>
    </div>
  )
}

export default withApprovedUser(ClientErrorsAdminPage)
