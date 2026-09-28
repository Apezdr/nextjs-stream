'use client'

import { useEffect, useReducer, useState } from 'react'
import { Dialog, DialogBackdrop, DialogPanel, DialogTitle, Transition } from '@headlessui/react'
import { XMarkIcon } from '@heroicons/react/24/outline'
import { toast } from 'react-toastify'
import HomeRowsEditor from './HomeRowsEditor'
import { homeRowsApi } from './homeRowsApi'
import { emptyEditorState, hasChanges, homeRowsReducer, rowsToSave } from './homeRowsState'

/**
 * "Home screen rows": choose which playlists show as rows on your home
 * screen, in what order and under what title. Full screen on phones.
 */
export default function HomeRowsDialog({ open, onClose }) {
  return (
    <Transition show={open}>
      <Dialog onClose={onClose} className="relative z-50">
        <DialogBackdrop transition className="fixed inset-0 bg-black/60 transition-opacity duration-200 data-[closed]:opacity-0" />
        <div className="fixed inset-0 flex items-stretch justify-center lg:items-center lg:p-6">
          <DialogPanel
            transition
            className="flex h-full w-full flex-col bg-gray-800 transition duration-200 data-[closed]:opacity-0 lg:h-[min(760px,90vh)] lg:max-w-5xl lg:rounded-xl lg:border lg:border-gray-700 lg:shadow-2xl"
          >
            {/* The Transition mounts this on each opening, so it loads current rows */}
            <HomeRowsDialogContent onClose={onClose} />
          </DialogPanel>
        </div>
      </Dialog>
    </Transition>
  )
}

function HomeRowsDialogContent({ onClose }) {
  const [state, dispatch] = useReducer(homeRowsReducer, emptyEditorState)
  const [status, setStatus] = useState('loading') // 'loading' | 'ready' | 'error'
  const [attempt, setAttempt] = useState(0)
  const [saving, setSaving] = useState(false)

  // `status` starts as 'loading'; a retry sets it again before bumping `attempt`
  useEffect(() => {
    let current = true
    homeRowsApi
      .load()
      .then((data) => {
        if (!current) return
        dispatch({ type: 'load', data })
        setStatus('ready')
      })
      .catch((error) => {
        if (!current) return
        console.error('[HomeRowsDialog] load failed:', error)
        setStatus('error')
      })
    return () => {
      current = false
    }
  }, [attempt])

  const changed = status === 'ready' && hasChanges(state)

  const save = async () => {
    if (!changed) {
      onClose()
      return
    }
    setSaving(true)
    try {
      await homeRowsApi.save(rowsToSave(state))
      toast.success('Home screen rows saved')
      onClose()
    } catch (error) {
      toast.error(error.message || 'Your rows could not be saved')
      setSaving(false)
    }
  }

  return (
    <>
      <header className="flex items-start justify-between gap-4 border-b border-gray-700 px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))] lg:px-7 lg:pb-5 lg:pt-6">
        <div className="min-w-0">
          <DialogTitle className="text-lg font-semibold text-white lg:text-xl">Home screen rows</DialogTitle>
          <p className="mt-1 text-sm text-gray-300">
            Choose the playlists that show as rows on your home screen, and put them in order.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-gray-300 hover:text-white lg:h-9 lg:w-9"
        >
          <XMarkIcon className="h-5 w-5" aria-hidden="true" />
        </button>
      </header>

      {status === 'ready' && <HomeRowsEditor state={state} dispatch={dispatch} />}
      {status === 'loading' && <EditorSkeleton />}
      {status === 'error' && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <p className="text-white">Your rows couldn&apos;t be loaded.</p>
          <button
            type="button"
            onClick={() => {
              setStatus('loading')
              setAttempt((n) => n + 1)
            }}
            className="h-10 rounded-md bg-gray-600 px-4 text-sm font-medium text-white hover:bg-gray-500"
          >
            Try again
          </button>
        </div>
      )}

      <footer className="flex items-center justify-between gap-4 border-t border-gray-700 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 lg:px-7 lg:pb-4">
        <span className="hidden text-sm text-gray-400 sm:inline">{changed ? 'Unsaved changes' : 'No changes yet'}</span>
        <div className="flex flex-1 justify-end gap-3 sm:flex-none">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="h-11 rounded-md bg-gray-600 px-4 text-sm font-medium text-white hover:bg-gray-500 disabled:opacity-50 lg:h-10"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving || status !== 'ready'}
            className="h-11 flex-1 rounded-md bg-indigo-600 px-5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50 sm:flex-none lg:h-10"
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </footer>
    </>
  )
}

export function EditorSkeleton() {
  return (
    <div className="grid min-h-0 flex-1 animate-pulse lg:grid-cols-5" aria-busy="true" aria-label="Loading rows">
      <div className="space-y-3 p-4 lg:col-span-3 lg:border-r lg:border-gray-700 lg:py-5 lg:pl-7 lg:pr-6">
        <div className="h-4 w-40 rounded bg-gray-700" />
        {[0, 1, 2].map((key) => (
          <div key={key} className="h-24 rounded-lg bg-gray-700" />
        ))}
      </div>
      <div className="hidden space-y-3 bg-gray-900/40 lg:col-span-2 lg:block lg:py-5 lg:pl-6 lg:pr-7">
        <div className="h-4 w-24 rounded bg-gray-700" />
        <div className="h-10 rounded-md bg-gray-700" />
        {[0, 1, 2, 3].map((key) => (
          <div key={key} className="h-14 rounded-lg bg-gray-700/60" />
        ))}
      </div>
    </div>
  )
}
