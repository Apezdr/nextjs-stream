import AdminOverviewPage from '@components/Admin/OverviewPage'
import { getAllUsers, getLastSynced } from '@src/utils/admin_database'
import { processUserData } from '@src/utils/admin_utils'
import { withApprovedUser } from '@components/HOC/ApprovedUser'
import { organizrURL } from '@src/utils/config'
import { adminGate } from '@src/lib/roles/gates'

async function AdminPage() {
  await adminGate.page()
  const allUsers = await getAllUsers()
  const _lastSyncTime = await getLastSynced()
  const processedUserData = processUserData(allUsers)
  const _organizrURL = organizrURL;

  return (
    <AdminOverviewPage
      processedUserData={processedUserData}
      _lastSyncTime={_lastSyncTime}
      organizrURL={_organizrURL}
    />
  )
}

export default withApprovedUser(AdminPage)
