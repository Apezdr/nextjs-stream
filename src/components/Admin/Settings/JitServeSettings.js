'use client'

import { useState, useTransition } from 'react'
import { toast } from 'react-toastify'
import { updateJitServeSettings } from '@src/utils/actions/admin_settings'

const MODE_HINTS = {
  env: 'No override — the server uses its JIT_SERVE_MODE environment variable.',
  off: 'Kill switch: every title plays its direct file URL, never the transcoder.',
  rescue: 'The transcoder is used only for files a browser cannot play directly (e.g. MKV).',
  prefer: 'The transcoder serves everything it can; direct play is the fallback.',
}

/**
 * Runtime control of the serve-time JIT delivery decision. Saves take
 * effect on every instance within ~20s (the serve layer's settings cache) —
 * no redeploy. 'Follow env' clears the override.
 */
export default function JitServeSettings({ mode = null, maxQueued = null, envMode = 'rescue' }) {
  const [selectedMode, setSelectedMode] = useState(mode ?? 'env')
  const [queued, setQueued] = useState(maxQueued === null ? '' : String(maxQueued))
  const [pending, startTransition] = useTransition()

  function onSubmit(event) {
    event.preventDefault()
    const formData = new FormData()
    formData.set('jitServeMode', selectedMode)
    formData.set('jitServeMaxQueued', queued.trim())
    startTransition(async () => {
      try {
        await updateJitServeSettings(formData)
        toast.success(
          <div className="flex flex-col">
            <span className="font-bold">JIT delivery settings saved</span>
            <span className="text-xs">Takes effect within ~20s on all instances</span>
          </div>,
          { autoClose: 3000, hideProgressBar: true }
        )
      } catch (error) {
        toast.error(error?.message || 'Failed to save JIT delivery settings')
      }
    })
  }

  return (
    <form onSubmit={onSubmit} className="w-full text-left">
      <dt className="font-medium text-gray-900">JIT Delivery</dt>
      <p className="mt-1 text-xs text-gray-500">
        Controls when playback is routed through the JIT transcoder instead of the
        direct file. Changes apply within ~20 seconds — no redeploy.
      </p>
      <dd className="mt-3 space-y-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="jit-serve-mode" className="text-xs font-medium text-gray-700">
            Delivery mode
          </label>
          <select
            id="jit-serve-mode"
            value={selectedMode}
            onChange={(e) => setSelectedMode(e.target.value)}
            className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900"
          >
            <option value="env">Follow env ({envMode})</option>
            <option value="off">Off — kill switch (always direct play)</option>
            <option value="rescue">Rescue — transcoder only when the browser can&apos;t play the file</option>
            <option value="prefer">Prefer — transcoder whenever available</option>
          </select>
          <p className="text-xs text-gray-500">{MODE_HINTS[selectedMode]}</p>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="jit-serve-max-queued" className="text-xs font-medium text-gray-700">
            Queue ceiling <span className="font-normal text-gray-500">(optional)</span>
          </label>
          <input
            id="jit-serve-max-queued"
            type="number"
            min="0"
            step="1"
            value={queued}
            onChange={(e) => setQueued(e.target.value)}
            placeholder="e.g. 4"
            className="w-32 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 placeholder:text-gray-400"
          />
          <p className="text-xs text-gray-500">
            Fall back to direct play when the transcoder reports more than this many
            queued encodes. Blank = no ceiling (liveness check only).
          </p>
        </div>

        <button
          type="submit"
          disabled={pending}
          className="px-3 py-1.5 bg-indigo-600 disabled:bg-indigo-300 text-white rounded-md text-sm"
        >
          {pending ? 'Saving…' : 'Save'}
        </button>
      </dd>
    </form>
  )
}
