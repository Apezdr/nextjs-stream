export default function AutomatedTasksSettings({ automatedTasks }) {
    return (
      <div>
        <h2 className="text-base font-semibold leading-7 text-gray-900">Automated Tasks</h2>
        <p className="mt-1 text-sm leading-6 text-gray-500">Overview of automated tasks and their frequencies.</p>
  
        <dl className="mt-6 space-y-6 divide-y divide-gray-100 border-t border-gray-200 text-sm leading-6">
          {Object.entries(automatedTasks).map(([taskName, taskDetails], index) => (
            <div key={index} className="pt-6 sm:flex">
              <div className="sm:flex sm:items-center sm:w-full">
                <dt className="font-medium text-gray-900 sm:w-64 sm:flex-none sm:pr-6 flex items-center">
                  {/* Optional: Add an icon for visual enhancement */}
                  {/* <ClockIcon className="h-5 w-5 text-gray-500 mr-2" /> */}
                  {formatTaskName(taskName)}
                </dt>
                <dd className="mt-1 sm:mt-0 sm:flex-auto">
                  <span className="text-gray-700">
                    every {`${taskDetails.frequency.value} ${taskDetails.frequency.unit}`}
                  </span>
                </dd>
              </div>
            </div>
          ))}
        </dl>
      </div>
    )
  }
  
  // Helper function to format task names
  function formatTaskName(taskName) {
    // Convert camelCase or snake_case to Start Case
    return taskName
      .replace(/([A-Z])/g, ' $1')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, char => char.toUpperCase())
      .trim()
  }
  