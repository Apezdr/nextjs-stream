import { auth } from '@src/lib/auth'
import { redirect } from 'next/navigation'
import { withApprovedUser } from '@components/HOC/ApprovedUser'
import { adminUserEmails } from '@src/utils/config'
import SettingsList from '@components/Admin/Settings/SettingsList'
import { getServerSettings } from '@src/utils/sync_db'
//import { updateAutomaticSync, updateSyncAggressiveness } from '@src/utils/actions/admin_settings'
export const revalidate = 0 // Ensure fresh data on each request

async function SettingsPage({ searchParams }) {
  const session = await auth()
  const settings = await getServerSettings()
  const params = await searchParams

  if ((session && session.user && !adminUserEmails.includes(session.user.email)) || !session) {
    redirect('/', 'replace')
  }

  // Handle visibility state from search parameters or default to all hidden
  let webhookVisibility = settings.webhookVisibility || []
  if (params.visibility) {
    // Parse visibility from query string (e.g., visibility=1:true,2:false)
    webhookVisibility = settings.webhookVisibility || []
    const visibilityParams = params.visibility.split(',')
    visibilityParams.forEach((param) => {
      const [index, value] = param.split(':')
      webhookVisibility[parseInt(index, 10)] = value === 'true'
    })
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-between xl:p-8">
      <div className="h-auto flex flex-col items-center justify-center md:mt-20 min-w-[90%] w-full md:w-auto max-w-[100vw]">
        <SettingsList settings={{ ...settings, webhookVisibility }} />
      </div>
    </div>
  )
}

export default withApprovedUser(SettingsPage)
