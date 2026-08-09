'use client'

import { useActionState } from 'react'
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline'
import { updateLocalAccess } from '@src/utils/actions/admin_settings'

/**
 * @param {object} props
 * @param {boolean} props.enabled current setting
 * @param {boolean} props.configured whether the deployment supplies a proxy assertion secret
 * @param {string|null} props.ownerEmail account local requests will act as
 * @param {string} props.allowedNetworks CIDR list currently in force
 */
export default function LocalAccessToggle({ enabled, configured, ownerEmail, allowedNetworks }) {
  const [state, action, pending] = useActionState(updateLocalAccess, {
    status: 'idle',
    enabled,
  })
  const isEnabled = state.enabled === true
  const displayEnabled = pending ? !isEnabled : isEnabled

  return (
    <div className="w-full">
      <form action={action} className="flex w-full items-center justify-between gap-4">
        <div className="text-left">
          <p className="text-sm font-medium text-gray-900">Local network sign-in</p>
          <p className="mt-1 text-xs text-gray-500">
            Treat requests from the networks below as {ownerEmail || 'the server owner'}, with no
            sign-in. Everything they do — including watch history — is recorded against that
            account, the way Plex attributes local playback to the server owner.
          </p>
        </div>
        <input type="hidden" name="localAccessEnabled" value={isEnabled ? 'false' : 'true'} />
        <button
          type="submit"
          disabled={pending || !configured}
          aria-pressed={displayEnabled}
          aria-label="Local network sign-in"
          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${
            displayEnabled ? 'bg-red-600 focus:ring-red-500' : 'bg-gray-300 focus:ring-indigo-500'
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

      {!configured ? (
        <p className="mt-2 rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-600">
          Unavailable until the deployment sets <code>LOCAL_ACCESS_ASSERTION_SECRET</code> and the
          reverse proxy forwards it. Until then this stays off no matter what a request claims.
        </p>
      ) : displayEnabled ? (
        <p className="mt-2 flex items-start gap-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-800">
          <ExclamationTriangleIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            Active for <span className="font-mono">{allowedNetworks}</span>. Anyone who can reach the
            server from those addresses has full owner access. Confirm your tunnel and port forwards
            terminate at the reverse proxy before relying on this.
          </span>
        </p>
      ) : (
        <p className="mt-2 text-xs text-gray-500">
          Applies to <span className="font-mono">{allowedNetworks}</span>.
        </p>
      )}
    </div>
  )
}
