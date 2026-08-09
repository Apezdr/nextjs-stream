'use client'

import { useActionState } from 'react'
import { updateAppTimeZone } from '@src/utils/actions/admin_settings'

export default function AppTimeZoneSettings({ timeZone }) {
  const [state, action, pending] = useActionState(updateAppTimeZone, { status: 'idle' })
  const supported = typeof Intl.supportedValuesOf === 'function'
    ? Intl.supportedValuesOf('timeZone')
    : [timeZone]

  return (
    <form action={action} className="mt-6 border-t border-gray-100 pt-6 text-left">
      <label htmlFor="app-time-zone" className="text-sm font-medium text-gray-900">Application time zone</label>
      <p className="mt-1 text-xs text-gray-500">Used for dates and times throughout the web app. Stored timestamps remain UTC.</p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <select
          id="app-time-zone"
          name="timeZone"
          defaultValue={timeZone}
          className="min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
        >
          {supported.map(zone => <option key={zone} value={zone}>{zone}</option>)}
        </select>
        <button type="submit" disabled={pending} className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">
          {pending ? 'Saving...' : 'Save time zone'}
        </button>
      </div>
      {state.message && <p className={`mt-2 text-xs ${state.status === 'error' ? 'text-red-600' : 'text-emerald-600'}`}>{state.message}</p>}
    </form>
  )
}