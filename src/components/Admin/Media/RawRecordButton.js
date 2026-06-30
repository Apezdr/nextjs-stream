'use client'

import { useState } from 'react'
import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from '@headlessui/react'
import { CodeBracketIcon, ClipboardIcon, XMarkIcon } from '@heroicons/react/24/outline'
import { toast } from 'react-toastify'

/**
 * Admin debugging affordance: shows the raw, client-serialized record (the exact
 * object the editor was hydrated with) in a scrollable JSON dialog with a
 * copy-to-clipboard button.
 *
 * The record is already serialized for the client (ObjectIds stringified, Dates
 * as ISO strings) by getAdminMovie/getAdminTVShow, so JSON.stringify is safe.
 *
 * @param {Object} props
 * @param {Object} props.record - The record to display.
 * @param {string} [props.title] - Dialog heading.
 * @param {boolean} [props.compact] - Smaller, icon-only button for nested rows.
 */
export default function RawRecordButton({ record, title = 'Raw record', compact = false }) {
  const [isOpen, setIsOpen] = useState(false)

  if (!record) return null

  const json = JSON.stringify(record, null, 2)

  async function copy() {
    try {
      await navigator.clipboard.writeText(json)
      toast.success('Record copied to clipboard')
    } catch {
      toast.error('Failed to copy record')
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        title="View raw record"
        className={
          compact
            ? 'inline-flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50'
            : 'inline-flex items-center gap-1 rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50'
        }
      >
        <CodeBracketIcon className={compact ? 'h-4 w-4' : 'h-4 w-4'} />
        {compact ? 'Raw' : 'View raw'}
      </button>

      <Dialog open={isOpen} onClose={setIsOpen} className="relative z-50">
        <DialogBackdrop className="fixed inset-0 bg-black/40" />
        <div className="fixed inset-0 flex items-center justify-center p-4">
          <DialogPanel className="flex w-full max-w-3xl flex-col rounded-lg bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
              <DialogTitle className="text-lg font-semibold text-gray-900">{title}</DialogTitle>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={copy}
                  className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  <ClipboardIcon className="h-4 w-4" /> Copy
                </button>
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <XMarkIcon className="h-5 w-5" />
                </button>
              </div>
            </div>
            <pre className="max-h-[70vh] overflow-auto rounded-b-lg bg-gray-900 px-4 py-3 font-mono text-xs leading-relaxed text-gray-100">
              {json}
            </pre>
          </DialogPanel>
        </div>
      </Dialog>
    </>
  )
}
