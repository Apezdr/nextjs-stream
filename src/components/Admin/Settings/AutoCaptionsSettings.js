'use client'

import { useState, useTransition } from 'react'
import { toast } from 'react-toastify'
import { updateAutoCaptions } from '@src/utils/actions/admin_settings'

const AVAILABLE_LANGS = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'it', name: 'Italian' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'nl', name: 'Dutch' },
  { code: 'pl', name: 'Polish' },
  { code: 'ru', name: 'Russian' },
  { code: 'ja', name: 'Japanese' },
  { code: 'ko', name: 'Korean' },
  { code: 'zh', name: 'Chinese' },
  { code: 'ar', name: 'Arabic' },
  { code: 'tr', name: 'Turkish' },
  { code: 'sv', name: 'Swedish' },
  { code: 'da', name: 'Danish' },
  { code: 'fi', name: 'Finnish' },
  { code: 'no', name: 'Norwegian' },
]

export default function AutoCaptionsSettings({ enabled = false, languages = [] }) {
  const [isEnabled, setIsEnabled] = useState(Boolean(enabled))
  const [selectedLangs, setSelectedLangs] = useState(() => new Set(languages || []))
  const [pending, startTransition] = useTransition()

  function toggleLang(code) {
    setSelectedLangs((prev) => {
      const next = new Set(prev)
      if (next.has(code)) next.delete(code)
      else next.add(code)
      return next
    })
  }

  function onSubmit(event) {
    event.preventDefault()
    if (isEnabled && selectedLangs.size === 0) {
      toast.error('Select at least one language to enable auto-captions')
      return
    }
    const formData = new FormData()
    formData.set('enabled', String(isEnabled))
    for (const code of selectedLangs) formData.append('languages', code)

    startTransition(async () => {
      try {
        await updateAutoCaptions(formData)
        toast.success(
          <div className="flex flex-col">
            <span className="font-bold">Auto-captions saved</span>
            <span className="text-xs">{new Date().toLocaleString()}</span>
          </div>,
          { autoClose: 3000, hideProgressBar: true }
        )
      } catch (err) {
        toast.error(err?.message || 'Failed to save auto-captions settings')
      }
    })
  }

  return (
    <form onSubmit={onSubmit} className="flex w-full flex-col gap-4 pt-6 text-left">
      <div className="flex w-full items-center">
        <dt className="flex-none pr-6 font-medium text-gray-900 sm:w-64">Auto-Captions</dt>
        <dd className="flex flex-auto items-center justify-end">
          <button
            type="button"
            aria-pressed={isEnabled}
            aria-label="Toggle auto-captions"
            className={`group flex w-8 cursor-pointer rounded-full p-px ring-1 ring-inset ring-gray-900/5 transition-colors duration-200 ease-in-out focus:outline-none ${
              isEnabled ? 'bg-indigo-600' : 'bg-gray-200'
            }`}
            onClick={() => setIsEnabled((v) => !v)}
          >
            <span
              aria-hidden="true"
              className={`h-4 w-4 transform rounded-full bg-white shadow-sm ring-1 ring-gray-900/5 transition duration-200 ease-in-out ${
                isEnabled ? 'translate-x-3.5' : 'translate-x-0'
              }`}
            />
          </button>
        </dd>
      </div>

      <div>
        <dt className="mb-2 font-medium text-gray-900">Languages</dt>
        <dd className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {AVAILABLE_LANGS.map(({ code, name }) => {
            const checked = selectedLangs.has(code)
            return (
              <label
                key={code}
                className="flex cursor-pointer items-center gap-2 text-sm text-gray-700"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleLang(code)}
                  className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                />
                <span>
                  {name} <span className="text-gray-500">({code})</span>
                </span>
              </label>
            )
          })}
        </dd>
        <p className="mt-2 text-xs text-gray-500">
          Non-English languages require a multilingual whisper.cpp model on the processor.
        </p>
      </div>

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-indigo-600 px-3 py-1 text-sm text-white transition-colors hover:bg-indigo-700 disabled:bg-indigo-300"
        >
          {pending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  )
}
