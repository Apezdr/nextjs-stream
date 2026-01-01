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

  const calendarConfig = {
    sonarr: !!process.env.SONARR_ICAL_LINK,
    radarr: !!process.env.RADARR_ICAL_LINK,
  }
  calendarConfig.hasAnyCalendar = calendarConfig.sonarr || calendarConfig.radarr

  return (
    <div className="flex flex-col justify-center">
      <div className="flex flex-col justify-center py-32 lg:py-0 sm:mt-20">
        {calendarConfig.hasAnyCalendar ? (
        <CalendarAdmin calendarConfig={calendarConfig} />
        ) : (
          <div className="flex flex-col items-center justify-center min-h-[400px] text-center">
            <h2 className="text-xl font-semibold text-gray-400 mb-4">No Calendar Services Configured</h2>
            <p className="text-gray-500 max-w-md">
              To use the calendar feature, please configure either Sonarr or Radarr calendar integration
              by setting the appropriate environment variables (SONARR_ICAL_LINK or RADARR_ICAL_LINK).
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

export default withApprovedUser(CalendarAdminPage)
