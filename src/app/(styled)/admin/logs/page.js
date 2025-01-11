import { auth } from '../../../../lib/auth'
import { redirect } from 'next/navigation'
import { withApprovedUser } from '@components/HOC/ApprovedUser'
import { adminUserEmails } from '@src/utils/config'
import LogsAdministration from '@components/Admin/Logs/LogsAdministration'

async function LogsAdminPage() {
  const session = await auth()

  if ((session && session.user && !adminUserEmails.includes(session.user.email)) || !session) {
    return redirect('/', 'replace')
  }
  return (
    <div className="flex flex-col justify-start min-h-[89vh] mt-8 mx-8">
      <main className="px-4 pb-8 lg:px-6 lg:flex-auto lg:py-20 bg-white md:rounded-lg w-full">
        <div className="mx-auto max-w-2xl space-y-16 sm:space-y-20 lg:mx-0 lg:max-w-none">
          <LogsAdministration />
        </div>
      </main>
    </div>
  )
}

export default withApprovedUser(LogsAdminPage)
