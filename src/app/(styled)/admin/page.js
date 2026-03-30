import AdminOverviewPage from '@components/Admin/OverviewPage'
import { getAllMedia, getAllUsers, getLastSynced } from '@src/utils/admin_database'
import { processMediaData, processUserData } from '@src/utils/admin_utils'
import { redirect } from 'next/navigation'
import { withApprovedUser } from '@components/HOC/ApprovedUser'
import { adminUserEmails, organizrURL } from '@src/utils/config'
import { getSession } from '@src/lib/cachedAuth'

async function AdminPage() {
  const session = await getSession();
  const allRecords = await getAllMedia()
  const allUsers = await getAllUsers()
  const _lastSyncTime = await getLastSynced()
  const processedData = processMediaData(allRecords)
  const processedUserData = processUserData(allUsers)
  const _organizrURL = organizrURL;

  if ((session && session.user && !adminUserEmails.includes(session.user.email)) || !session) {
    return redirect('/', 'replace')
  }
  return (
    <AdminOverviewPage
      processedData={processedData}
      processedUserData={processedUserData}
      _lastSyncTime={_lastSyncTime}
      organizrURL={_organizrURL}
    />
  )
}

export default withApprovedUser(AdminPage)
