import AdminOverviewPage from '@components/Admin/OverviewPage'
import { auth } from '../../lib/auth'
import { getAllMedia, getAllUsers, getLastSynced } from '../../utils/admin_database'
import { processMediaData, processUserData } from '../../utils/admin_utils'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { withApprovedUser } from '@components/HOC/ApprovedUser'
import { adminUserEmails, organizrURL } from '@src/utils/config'

async function AdminPage() {
  const session = await auth()
  const allRecords = await getAllMedia()
  const allUsers = await getAllUsers()
  const _lastSyncTime = await getLastSynced()
  const processedData = processMediaData(allRecords)
  const processedUserData = processUserData(allUsers)

  if ((session && session.user && !adminUserEmails.includes(session.user.email)) || !session) {
    return redirect('/', 'replace')
  }
  return (
    <div className="flex min-h-screen flex-col items-center justify-between xl:p-24">
      <Link href="/list" className="self-center mt-16">
        <button
          type="button"
          className="flex flex-row gap-x-2 rounded bg-indigo-600 px-2 py-1 text-base font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
            className="w-6 h-6"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3"
            />
          </svg>
          Go Back
        </button>
      </Link>
      <div className="h-auto flex flex-col items-center justify-center py-32 lg:py-0 sm:mt-20">
        <AdminOverviewPage
          processedData={processedData}
          processedUserData={processedUserData}
          _lastSyncTime={_lastSyncTime}
          organizrURL={organizrURL}
        />
      </div>
    </div>
  )
}

export default withApprovedUser(AdminPage)
