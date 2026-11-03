import { getAllUsers } from '../../../../utils/admin_database'
import { processUserData } from '../../../../utils/admin_utils'
import { withApprovedUser } from '@components/HOC/ApprovedUser'
import UserAdmin from '@components/Admin/Users/UserAdministration'
import { listRoles } from '@src/lib/roles/store'
import { adminGate } from '@src/lib/roles/gates'

async function UserAdminPage() {
  await adminGate.page()
  const allUsers = await getAllUsers()
  const processedUserData = processUserData(allUsers)
  const roleOptions = (await listRoles()).map(({ id, name }) => ({ id, name }))


  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.12),_transparent_35%),linear-gradient(to_bottom,_rgba(2,6,23,0.85),_rgba(2,6,23,0.96))] px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-7xl">
        <UserAdmin processedUserData={processedUserData} roleOptions={roleOptions} />
      </div>
    </div>
  )
}

export default withApprovedUser(UserAdminPage)