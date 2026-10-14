import { redirect } from 'next/navigation'
import { withApprovedUser } from '@components/HOC/ApprovedUser'
import { adminUserEmails, siteTitle } from '@src/utils/config'
import { getSession } from '@src/lib/cachedAuth'
import RolesAdmin from '@components/Admin/Roles/RolesAdmin'
import { summarize } from '@src/lib/roles/capability'
import { capabilityEditorData } from '@src/lib/roles/editorData'
import { CAPABILITIES } from '@src/lib/roles/registry'
import { holdersByRole, listRoles } from '@src/lib/roles/store'

export const metadata = {
  title: `Roles - Admin - ${siteTitle}`,
  description: 'What non-admin users may do, as roles given to them',
}

async function RolesAdminPage() {
  const session = await getSession()

  if ((session && session.user && !adminUserEmails.includes(session.user.email)) || !session) {
    return redirect('/', 'replace')
  }

  const [roles, holders, editorData] = await Promise.all([listRoles(), holdersByRole(), capabilityEditorData()])

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.12),_transparent_35%),linear-gradient(to_bottom,_rgba(2,6,23,0.85),_rgba(2,6,23,0.96))] px-4 py-6 sm:px-6 lg:px-8">
      <RolesAdmin
        roles={roles}
        holders={holders}
        capabilities={CAPABILITIES.map(summarize)}
        editorData={editorData}
      />
    </div>
  )
}

export default withApprovedUser(RolesAdminPage)
