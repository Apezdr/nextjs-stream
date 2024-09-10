import ReleaseCalendar from '@components/Calendar/ReleaseCalendar'

export default function CalendarAdmin() {
  return (
    <>
      <h1 className="block">Calendar Management</h1>
      <div className="flex flex-col w-full min-h-screen">
        <ReleaseCalendar aspectRatio={3.2} containerClasses={'w-full mx-auto mt-4'} />
      </div>
    </>
  )
}
