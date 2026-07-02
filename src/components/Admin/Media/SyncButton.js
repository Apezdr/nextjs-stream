'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowPathIcon } from '@heroicons/react/24/outline'
import SyncMediaPopup from '../SyncMediaPopup'

/**
 * Trigger for the (kept) SyncMediaPopup. On completion it refreshes the RSC
 * route so freshly-synced data appears without a manual reload.
 */
export default function SyncButton() {
  const [open, setOpen] = useState(false)
  const router = useRouter()

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500"
      >
        <ArrowPathIcon className="h-5 w-5" /> Sync with Fileserver
      </button>
      {/* Always mounted so Headless UI runs its close teardown (conditionally unmounting
          a Dialog while open strands the page-wide pointer-events lock — app unclickable). */}
      <SyncMediaPopup
        isOpen={open}
        setIsOpen={setOpen}
        updateProcessedData={() => router.refresh()}
        setLastSync={() => router.refresh()}
      />
    </>
  )
}
