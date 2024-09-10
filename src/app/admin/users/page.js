import { auth } from '../../../lib/auth'
import { getAllUsers } from '../../../utils/admin_database'
import { processUserData } from '../../../utils/admin_utils'
import { redirect } from 'next/navigation'
import { withApprovedUser } from '@components/HOC/ApprovedUser'
import { adminUserEmails } from '@src/utils/config'
import UserAdmin from '@components/Admin/Users/UserAdministration'

async function UserAdminPage() {
  const session = await auth()
  const allUsers = await getAllUsers()
  const processedUserData = processUserData(allUsers)

  if ((session && session.user && !adminUserEmails.includes(session.user.email)) || !session) {
    return redirect('/', 'replace')
  }
  return (
    <div className="flex min-h-screen flex-col items-center justify-between xl:p-8">
      <div className="h-auto flex flex-col items-center justify-center py-32 lg:py-0 sm:mt-20">
        <UserAdmin processedUserData={processedUserData} />
      </div>
    </div>
  )
}

export default withApprovedUser(UserAdminPage)
