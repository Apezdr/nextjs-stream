import ReleaseCalendar from '@components/Calendar/ReleaseCalendar'

export default function CalendarAdmin({ calendarConfig = { hasAnyCalendar: false } }) {
  return (
    <>
      <h1 className="block">Calendar Management</h1>
      <div className="flex flex-col w-full min-h-screen">
        {calendarConfig.hasAnyCalendar ? (
          <ReleaseCalendar
            aspectRatio={3.2}
            containerClasses={'w-full mx-auto mt-4'}
            calendarConfig={calendarConfig}
          />
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
    </>
  )
}
