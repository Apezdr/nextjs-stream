'use client'

import { useState } from 'react'
import { EyeIcon, EyeSlashIcon } from '@heroicons/react/20/solid'
import { obfuscateString } from '@src/utils'

export default function WebhookSettings({ webhookKeys, initialVisibility }) {
  const [visibility, setVisibility] = useState(initialVisibility)

  const handleToggle = (index) => {
    setVisibility((prev) => {
      const newVisibility = [...prev]
      newVisibility[index] = !newVisibility[index]
      return newVisibility
    })
  }

  return (
    <div className="w-full">
      <h2 className="text-base font-semibold leading-7 text-gray-900">Webhook Settings</h2>
      <p className="mt-1 text-sm leading-6 text-gray-500">
        Webhook keys are essential for automation. Server keys map to specific servers; wildcard keys
        authenticate to this server without being tied to one server.
      </p>

      <dl className="mt-6 divide-y divide-gray-100 border-y border-gray-200 text-sm leading-6 bg-white rounded-md">
        {webhookKeys.map((entry, index) => (
          <div key={index} className="py-4 px-3 sm:px-4">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <dt className="font-medium text-gray-900 flex items-center gap-2 flex-wrap">
                  <span>{entry.label || `Webhook Key ${index + 1}`}</span>
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                      entry.type === 'wildcard'
                        ? 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200'
                        : 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200'
                    }`}
                  >
                    {entry.type === 'wildcard' ? 'Wildcard' : 'Server'}
                  </span>
                </dt>
                <div className="text-xs text-gray-500 mt-0.5">{entry.envKey || `WEBHOOK_ID_${index + 1}`}</div>
              </div>
              <dd className="flex items-center gap-x-3 sm:gap-x-4">
                <div className="text-gray-900 font-medium tracking-wide">
                  {visibility[index] ? entry.key : obfuscateString(entry.key)}
                </div>
                <button type="button" onClick={() => handleToggle(index)} className="ml-2">
                  {visibility[index] ? (
                    <EyeSlashIcon className="h-5 w-5 text-gray-500" />
                  ) : (
                    <EyeIcon className="h-5 w-5 text-gray-500" />
                  )}
                </button>
              </dd>
            </div>
          </div>
        ))}
      </dl>
    </div>
  )
}
