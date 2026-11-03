import { withApprovedUser } from '@components/HOC/ApprovedUser'
import { siteTitle } from '@src/utils/config'
import IdentityReport from '@components/Admin/Identity/IdentityReport'
import { adminGate } from '@src/lib/roles/gates'

export const metadata = {
  title: `Title Matching - Admin - ${siteTitle}`,
  description: 'Whether each library folder is linked to the right movie or show, as Radarr and Sonarr know it',
}

async function IdentityAdminPage() {
  await adminGate.page()


  // The report brings the dashboard's own light surface (min-h-screen bg-gray-50),
  // the same as the admin overview page, so no wrapper here.
  return <IdentityReport />
}

export default withApprovedUser(IdentityAdminPage)
