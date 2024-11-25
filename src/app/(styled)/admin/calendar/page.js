import { auth } from '../../../../lib/auth'
import { redirect } from 'next/navigation'
import { withApprovedUser } from '@components/HOC/ApprovedUser'
import { adminUserEmails } from '@src/utils/config'
import CalendarAdmin from '@components/Admin/Calendar/CalendarAdministration'

async function CalendarAdminPage() {
  const session = await auth()

  if ((session && session.user && !adminUserEmails.includes(session.user.email)) || !session) {
    return redirect('/', 'replace')
  }
  return (
    <div className="flex flex-col justify-center">
      <div className="flex flex-col justify-center py-32 lg:py-0 sm:mt-20">
        <CalendarAdmin />
      </div>
    </div>
  )
}

export default withApprovedUser(CalendarAdminPage)
