'use client'

import { LockClosedIcon, LockOpenIcon } from '@heroicons/react/24/outline'
import { classNames } from '@src/utils'

/**
 * A labeled input with an optional per-field lock toggle.
 *
 * Locking a field persists it into the media doc's `lockedFields` so the sync
 * pipeline (filterLockedFields) will not overwrite the admin's manual value.
 * The lock state is carried by the toggle's pressed state, label and icon
 * (closed / open padlock); the amber field only repeats it.
 *
 * `helpText` describes the input (aria-describedby). A field that locks
 * itself when the admin changes it (useFieldLocks) passes `autoLocked`: the
 * field then keeps a polite live region, which says so when it happens.
 */
export default function LockableField({
  id,
  label,
  value,
  onChange,
  locked = false,
  onToggleLock,
  placeholder = '',
  type = 'text',
  textarea = false,
  rows = 3,
  disabled = false,
  helpText,
  autoLocked,
}) {
  const helpId = helpText ? `${id}-help` : undefined
  const inputClass = classNames(
    'mt-1 block w-full rounded-md border px-3 py-2 text-sm text-gray-900 shadow-sm',
    'focus:border-indigo-500 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:bg-gray-100',
    locked ? 'border-amber-300 bg-amber-50' : 'border-gray-300 bg-white'
  )

  return (
    <div>
      <div className="flex items-center justify-between">
        <label htmlFor={id} className="block text-sm font-medium text-gray-700">
          {label}
        </label>
        {onToggleLock && (
          <button
            type="button"
            onClick={onToggleLock}
            aria-pressed={locked}
            title={
              locked
                ? 'Locked — sync will not overwrite this field'
                : 'Unlocked — sync may overwrite this field'
            }
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-gray-500 hover:bg-gray-100"
          >
            {locked ? (
              <LockClosedIcon className="h-4 w-4 text-amber-600" />
            ) : (
              <LockOpenIcon className="h-4 w-4 text-gray-400" />
            )}
            <span className="sr-only">{locked ? 'Unlock' : 'Lock'} {label}</span>
          </button>
        )}
      </div>
      {textarea ? (
        <textarea
          id={id}
          rows={rows}
          value={value ?? ''}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          aria-describedby={helpId}
          className={inputClass}
        />
      ) : (
        <input
          id={id}
          type={type}
          value={value ?? ''}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          aria-describedby={helpId}
          className={inputClass}
        />
      )}
      {helpText && (
        <p id={helpId} className="mt-1 text-xs text-gray-400">
          {helpText}
        </p>
      )}
      {autoLocked !== undefined && (
        // Present from the first render, so the change is announced.
        <p role="status" aria-live="polite" className="sr-only">
          {autoLocked ? `${label} locked, so the sync keeps your change. Unlock it to let the sync set it again.` : ''}
        </p>
      )}
    </div>
  )
}
