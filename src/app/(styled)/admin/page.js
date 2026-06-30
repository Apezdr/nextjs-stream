import AdminOverviewPage from '@components/Admin/OverviewPage'
import { getAllUsers, getLastSynced } from '@src/utils/admin_database'
import { processUserData } from '@src/utils/admin_utils'
import { redirect } from 'next/navigation'
import { withApprovedUser } from '@components/HOC/ApprovedUser'
import { adminUserEmails, organizrURL } from '@src/utils/config'
import { getSession } from '@src/lib/cachedAuth'

async function AdminPage() {
  const session = await getSession();
  const allUsers = await getAllUsers()
  const _lastSyncTime = await getLastSynced()
  const processedUserData = processUserData(allUsers)
  const _organizrURL = organizrURL;

  if ((session && session.user && !adminUserEmails.includes(session.user.email)) || !session) {
    return redirect('/', 'replace')
  }
  return (
    <AdminOverviewPage
      processedUserData={processedUserData}
      _lastSyncTime={_lastSyncTime}
      organizrURL={_organizrURL}
    />
  )
}

export default withApprovedUser(AdminPage)
