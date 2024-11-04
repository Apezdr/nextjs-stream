'use client'

import { useState } from 'react'
import { EyeIcon, EyeSlashIcon } from '@heroicons/react/20/solid'
import { obfuscateString } from '@src/utils'

export default function WebhookSettings({ webhookIdsArray, initialVisibility }) {
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
        Webhook keys are essential for automation. To change these update your docker file.
      </p>

      <dl className="mt-6 space-y-6 divide-y divide-gray-100 border-t border-gray-200 text-sm leading-6">
        {webhookIdsArray.map((key, index) => (
          <div key={index} className="pt-6 sm:flex">
            <div className="sm:flex sm:items-center sm:w-full">
              <dt className="font-medium text-gray-900 sm:w-64 sm:flex-none sm:pr-2">
                Webhook Key {index + 1}
              </dt>
              <dd className="mt-1 flex justify-between gap-x-6 sm:mt-0 sm:flex-auto">
                <div className="text-gray-900">
                  {visibility[index] ? key : obfuscateString(key)}
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
