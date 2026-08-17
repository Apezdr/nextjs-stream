'use client'

import { useActionState } from 'react'
import { updateSyncServerLatency } from '@src/utils/actions/admin_settings'

export default function SyncServerLatencyToggle({ enabled }) {
  const [state, action, pending] = useActionState(updateSyncServerLatency, {
    status: 'idle',
    enabled,
  })
  const isEnabled = state.enabled !== false
  const displayEnabled = pending ? !isEnabled : isEnabled

  return (
    <form action={action} className="flex w-full items-center justify-between gap-4">
      <div className="text-left">
        <p className="text-sm font-medium text-gray-900">Remote sync-server latency</p>
        <p className="mt-1 text-xs text-gray-500">
          Measure bounded round-trip time to configured remote sync servers for the Admin dashboard.
        </p>
      </div>
      <input
        type="hidden"
        name="syncServerLatencyEnabled"
        value={isEnabled ? 'false' : 'true'}
      />
      <button
        type="submit"
        disabled={pending}
        aria-pressed={displayEnabled}
        aria-label="Remote sync-server latency checks"
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-60 ${
          displayEnabled ? 'bg-indigo-600' : 'bg-gray-300'
        }`}
      >
        <span
          aria-hidden="true"
          className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
            displayEnabled ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </button>
    </form>
  )
}