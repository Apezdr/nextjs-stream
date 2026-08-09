'use client'

import { useActionState } from 'react'
import { updateServerDisplayName } from '@src/utils/actions/admin_settings'

const INITIAL_STATE = { status: 'idle', message: '' }

export default function ServerDisplayNameForm({
  serverId,
  displayName,
  displayNameOverride,
  displayNameEditable,
  displayNameEnvironmentVariable,
}) {
  const [state, action, pending] = useActionState(updateServerDisplayName, INITIAL_STATE)

  return (
    <form action={action} autoComplete="off" className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
      <input type="hidden" name="serverId" value={serverId} />
      <label htmlFor={`server-name-${serverId}`} className="sr-only">
        Display name for {displayName}
      </label>
      {/* A lone text field named "…name" reads as a username prompt to password managers; opt out explicitly. */}
      <input
        key={`${serverId}:${displayNameEditable ? displayNameOverride : displayName}`}
        id={`server-name-${serverId}`}
        name="displayName"
        type="text"
        maxLength={60}
        defaultValue={displayNameEditable ? displayNameOverride : displayName}
        placeholder={displayName}
        disabled={!displayNameEditable || pending}
        autoComplete="off"
        data-lpignore="true"
        data-1p-ignore="true"
        data-bwignore="true"
        data-form-type="other"
        className="min-w-0 flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
      />
      {displayNameEditable ? (
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:cursor-wait disabled:opacity-60"
        >
          {pending ? 'Saving...' : 'Save name'}
        </button>
      ) : (
        <span className="text-xs font-medium text-gray-500">
          Managed by Docker Compose via <code>{displayNameEnvironmentVariable}</code>
        </span>
      )}
      {displayNameEditable && state.message ? (
        <span className={`text-xs ${state.status === 'error' ? 'text-red-600' : 'text-emerald-600'}`}>
          {state.message}
        </span>
      ) : null}
    </form>
  )
}