import { obfuscateString } from '@src/utils'
import { updateAutomaticSync, updateSyncAggressiveness } from '@src/utils/actions/admin_settings'
import WebhookSettings from '@components/Admin/Settings/WebhookSettings'
import AutomatedTasksSettings from '@components/Admin/Settings/AutomatedTasksSettings'
import AutoSyncToggle from '@components/Admin/Settings/AutoSyncToggle'
import LastSyncTime from '@components/Admin/Settings/LastSyncTime'
import { EyeIcon, EyeSlashIcon } from '@heroicons/react/20/solid'
import ServerList from './ServerList'

export default function SettingsList({ settings }) {
  const {
    webhookIds,
    fileImport,
    fileServerURL,
    fileServerPrefixPath,
    organizrURL,
    nodeJSURL,
    syncTVURL,
    syncMoviesURL,
    lastSyncTime,
    syncAggressiveness,
    automaticSyncEnabled,
    webhookVisibility,
    automated,
  } = settings

  // Split webhookIds string by comma to create an array
  const webhookIdsArray = webhookIds ? webhookIds.split(',') : []

  // Initialize visibility states from server or default to false
  const initialVisibility = webhookVisibility || webhookIdsArray.map(() => false)

  const syncSettings = [
    {
      label: 'Sync Aggressiveness',
      value: syncAggressiveness,
      options: ['Minimal', 'Standard', 'Aggressive', 'Full'],
    },
    {
      label: 'Auto-sync',
      type: 'switch',
      checked: automaticSyncEnabled,
    },
  ]

  return (
    <main className="px-4 py-16 lg:px-6 lg:flex-auto lg:py-20 bg-white md:rounded-lg w-full">
      <div className="mx-auto max-w-2xl space-y-16 sm:space-y-20 lg:mx-0 lg:max-w-none">
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-28">
          <ServerList {...settings} />
          {/* Integrate the WebhookSettings client component */}
          <WebhookSettings
            webhookIdsArray={webhookIdsArray}
            initialVisibility={initialVisibility}
          />
        </div>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-28">
          {/* Automated Tasks Settings */}
          <AutomatedTasksSettings automatedTasks={automated} />
          {/* Sync Settings */}
          <SettingsSection
            title="Sync Settings"
            description="Configure your synchronization settings here."
            settings={syncSettings}
            lastSyncTime={lastSyncTime}
          />
        </div>
      </div>
    </main>
  )
}

function SettingsSection({ title, description, settings, lastSyncTime }) {
  return (
    <div className="flex flex-col items-center justify-between gap-x-6 text-center w-auto">
      <div>
        <h2 className="text-base font-semibold leading-7 text-gray-900">{title}</h2>
        <p className="mt-1 text-sm leading-6 text-gray-500">{description}</p>

        <dl className="mt-6 space-y-6 divide-y divide-gray-100 border-t border-gray-200 text-sm leading-6">
          {settings.map((setting, index) => (
            <div key={index} className={setting.type === 'switch' ? 'flex pt-6' : 'pt-6 sm:flex'}>
              {setting.type === 'switch' ? (
                <AutoSyncForm label={setting.label} checked={setting.checked} />
              ) : setting.options ? (
                <SyncAggressivenessForm
                  label={setting.label}
                  value={setting.value}
                  options={setting.options}
                />
              ) : (
                <div className="sm:flex sm:items-center w-full">
                  <dt
                    className="font-medium text-gray-900 sm:w-64 sm:flex-none sm:pr-6"
                    title={setting.label}
                  >
                    {setting.label}
                  </dt>
                  <dd className="mt-1 contents justify-between gap-x-6 sm:mt-0 sm:flex-auto">
                    <div className="text-gray-900" title={setting.value}>
                      {setting.obfuscate
                        ? setting.isVisible
                          ? setting.value
                          : obfuscateString(setting.value)
                        : setting.value}
                    </div>
                    {setting.obfuscate && (
                      <VisibilityToggle
                        isVisible={setting.isVisible}
                        index={setting.webhookIndex}
                      />
                    )}
                  </dd>
                </div>
              )}
            </div>
          ))}
        </dl>
      </div>
      {lastSyncTime && <LastSyncTime lastSyncTime={lastSyncTime} />}
    </div>
  )
}

function VisibilityToggle({ isVisible, index, currentVisibility }) {
  // Prepare the visibility state to be submitted with the form
  const updatedVisibility = currentVisibility.map((vis, i) => (i === index ? !vis : vis))

  // Convert the visibility array to a comma-separated string for query parameters
  const visibilityParam = updatedVisibility.map((vis, i) => `${i}:${vis}`).join(',')

  return (
    <form className="ml-2">
      {/* Include the updated visibility as a hidden input */}
      <input type="hidden" name="visibility" value={visibilityParam} />
      <button type="submit" className="ml-2">
        {isVisible ? (
          <EyeSlashIcon className="h-5 w-5 text-gray-500" />
        ) : (
          <EyeIcon className="h-5 w-5 text-gray-500" />
        )}
      </button>
    </form>
  )
}

function SyncAggressivenessForm({ label, value, options }) {
  return (
    <form
      action={updateSyncAggressiveness}
      method="POST"
      className="sm:flex sm:items-center w-full"
    >
      <dt className="font-medium text-gray-900 sm:w-64 sm:flex-none sm:pr-6">{label}</dt>
      <dd className="mt-1 flex items-center gap-x-6 sm:mt-0 sm:flex-auto">
        <select
          name="syncAggressiveness"
          defaultValue={value}
          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm text-gray-900"
          disabled
        >
          {options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <button
          disabled
          type="submit"
          className="ml-2 px-3 py-1 bg-indigo-600 disabled:bg-indigo-200 text-white rounded-md"
        >
          Update
        </button>
      </dd>
    </form>
  )
}

function AutoSyncForm({ label, checked }) {
  return (
    <form action={updateAutomaticSync} method="POST" className="flex w-full">
      <dt className="flex-none pr-6 font-medium text-gray-900 sm:w-64">{label}</dt>
      <AutoSyncToggle checked={checked} />
    </form>
  )
}
