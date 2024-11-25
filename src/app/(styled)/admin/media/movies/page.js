import { auth } from '../../../../../lib/auth'
import { getAllMedia, getLastSynced } from '../../../../../utils/admin_database'
import { processMediaData } from '../../../../../utils/admin_utils'
import { redirect } from 'next/navigation'
import { withApprovedUser } from '@components/HOC/ApprovedUser'
import { adminUserEmails, organizrURL } from '@src/utils/config'
import MovieAdministration from '@components/Admin/Media/Movie/MovieAdministration'

async function MovieAdministrationPage() {
  const session = await auth()
  const allRecords = await getAllMedia({ type: 'movie' })
  const _lastSyncTime = await getLastSynced()
  const processedData = processMediaData(allRecords)

  if ((session && session.user && !adminUserEmails.includes(session.user.email)) || !session) {
    return redirect('/', 'replace')
  }
  return (
    <div className="flex min-h-screen flex-col items-center justify-between xl:p-8">
      <div className="h-auto flex flex-col items-center justify-center py-32 lg:py-0 sm:mt-20">
        <MovieAdministration
          processedData={processedData}
          _lastSyncTime={_lastSyncTime}
          organizrURL={organizrURL}
        />
      </div>
    </div>
  )
}

export default withApprovedUser(MovieAdministrationPage)
