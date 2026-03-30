import { getAllUsers } from '../../../../utils/admin_database'
import { processUserData } from '../../../../utils/admin_utils'
import { redirect } from 'next/navigation'
import { withApprovedUser } from '@components/HOC/ApprovedUser'
import { adminUserEmails } from '@src/utils/config'
import UserAdmin from '@components/Admin/Users/UserAdministration'
import { getSession } from '@src/lib/cachedAuth'

async function UserAdminPage() {
  const session = await getSession()
  const allUsers = await getAllUsers()
  const processedUserData = processUserData(allUsers)

  if ((session && session.user && !adminUserEmails.includes(session.user.email)) || !session) {
    return redirect('/', 'replace')
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.12),_transparent_35%),linear-gradient(to_bottom,_rgba(2,6,23,0.85),_rgba(2,6,23,0.96))] px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-7xl">
        <UserAdmin processedUserData={processedUserData} />
      </div>
    </div>
  )
}

export default withApprovedUser(UserAdminPage)