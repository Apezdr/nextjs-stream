'use client'

import { Radio, RadioGroup } from '@headlessui/react'
import { CheckIcon, ListBulletIcon, LockClosedIcon, LockOpenIcon, Squares2X2Icon } from '@heroicons/react/24/outline'
import BottomSheet from './BottomSheet'

// `${sortBy}-${sortOrder}` pairs, shared with the desktop sort <select>.
export const SORT_OPTIONS = [
  { value: 'dateAdded-desc', label: 'Recently Added' },
  { value: 'dateAdded-asc', label: 'Oldest First' },
  { value: 'title-asc', label: 'Title A-Z' },
  { value: 'title-desc', label: 'Title Z-A' },
  { value: 'releaseDate-desc', label: 'Newest Releases First' },
  { value: 'releaseDate-asc', label: 'Oldest Releases First' },
  { value: 'custom-asc', label: 'Custom Order' },
]

export function sortLabel(sortBy, sortOrder) {
  return SORT_OPTIONS.find((option) => option.value === `${sortBy}-${sortOrder}`)?.label || 'Custom Order'
}

/**
 * Sort order, its lock, and grid/list view, in one sheet: the desktop toolbar
 * spreads these across a lock button, a <select> and a toggle, which do not
 * fit beside the search box on a phone. The same rules apply: only editors see
 * the lock, and the order can't change while it is locked.
 */
export default function MobileSortSheet({
  open,
  onClose,
  sortBy,
  sortOrder,
  onSortChange,
  sortLocked,
  canEditPlaylist,
  onToggleSortLock,
  viewMode,
  onViewModeChange,
}) {
  return (
    <BottomSheet open={open} onClose={onClose} title="Sort & view">
      <section className="border-t border-gray-700 pt-3">
        <h3 className="px-4 text-xs font-semibold uppercase tracking-wider text-gray-400">View</h3>
        <RadioGroup value={viewMode} onChange={onViewModeChange} aria-label="Layout" className="mt-2 flex gap-2 px-4">
          <Radio
            value="grid"
            className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg bg-gray-700 py-2.5 text-sm font-medium text-gray-300 focus:outline-none data-[focus]:ring-2 data-[focus]:ring-indigo-500 data-[checked]:bg-indigo-600 data-[checked]:text-white"
          >
            <Squares2X2Icon className="h-5 w-5" aria-hidden="true" />
            Grid
          </Radio>
          <Radio
            value="list"
            className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg bg-gray-700 py-2.5 text-sm font-medium text-gray-300 focus:outline-none data-[focus]:ring-2 data-[focus]:ring-indigo-500 data-[checked]:bg-indigo-600 data-[checked]:text-white"
          >
            <ListBulletIcon className="h-5 w-5" aria-hidden="true" />
            List
          </Radio>
        </RadioGroup>
      </section>

      <section className="mt-5">
        <h3 className="px-4 text-xs font-semibold uppercase tracking-wider text-gray-400">Sort by</h3>

        {canEditPlaylist ? (
          <>
            <div className="mx-4 mt-2 flex items-center justify-between gap-3 rounded-lg bg-gray-700/60 px-3 py-2">
              <div className="flex min-w-0 items-center gap-2 text-sm text-gray-200">
                {sortLocked ? (
                  <LockClosedIcon className="h-5 w-5 shrink-0 text-red-400" aria-hidden="true" />
                ) : (
                  <LockOpenIcon className="h-5 w-5 shrink-0 text-green-400" aria-hidden="true" />
                )}
                <span className="truncate">{sortLocked ? 'Order is locked' : 'Order is unlocked'}</span>
              </div>
              <button
                type="button"
                onClick={onToggleSortLock}
                className="shrink-0 rounded-md bg-gray-600 px-3 py-1.5 text-sm font-medium text-white active:bg-gray-500"
              >
                {sortLocked ? 'Unlock' : 'Lock'}
              </button>
            </div>
            {/* Rearranging lives in each item's "…" sheet, and only while unlocked */}
            <p className="mt-1.5 px-4 text-xs text-gray-400">
              {sortLocked
                ? 'Unlock to re-sort, or to rearrange items from their ⋯ menu.'
                : 'You can also rearrange items one by one from their ⋯ menu.'}
            </p>
          </>
        ) : (
          <p className="mt-1 px-4 text-sm text-gray-400">Only people who can edit this playlist can change its order.</p>
        )}

        <RadioGroup
          value={`${sortBy}-${sortOrder}`}
          onChange={(value) => {
            const [newSortBy, newSortOrder] = value.split('-')
            onSortChange(newSortBy, newSortOrder)
          }}
          disabled={sortLocked}
          aria-label="Sort playlist items"
          className="mt-1"
        >
          {SORT_OPTIONS.map((option) => (
            <Radio
              key={option.value}
              value={option.value}
              className="group flex cursor-pointer items-center justify-between px-4 py-2.5 text-base text-gray-100 focus:outline-none data-[focus]:bg-gray-700 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50"
            >
              <span>{option.label}</span>
              <CheckIcon className="invisible h-5 w-5 text-indigo-400 group-data-[checked]:visible" aria-hidden="true" />
            </Radio>
          ))}
        </RadioGroup>
      </section>

      <div className="px-4 pt-3">
        <button
          type="button"
          onClick={onClose}
          className="w-full rounded-lg bg-gray-700 py-3 text-base font-medium text-white active:bg-gray-600"
        >
          Done
        </button>
      </div>
    </BottomSheet>
  )
}
