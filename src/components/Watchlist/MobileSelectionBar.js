'use client'

import { DocumentDuplicateIcon, FolderArrowDownIcon, TrashIcon, XMarkIcon } from '@heroicons/react/24/outline'
import { classNames } from '@src/utils'

function BarButton({ icon: Icon, label, onClick, disabled, tone = 'default' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={classNames(
        'flex flex-1 flex-col items-center gap-1 rounded-lg py-2 text-xs font-medium transition-colors active:bg-gray-700 disabled:opacity-40',
        tone === 'danger' ? 'text-red-400' : 'text-gray-100'
      )}
    >
      <Icon className="h-6 w-6" aria-hidden="true" />
      {label}
    </button>
  )
}

/**
 * Bulk actions for phones, pinned to the bottom of the screen while items are
 * selected: the desktop "N selected" dropdown lives in a toolbar row that the
 * mobile layout doesn't have. Copy is open to everyone who can see the
 * playlist; Move and Remove need edit rights, as on desktop.
 */
export default function MobileSelectionBar({
  count,
  total,
  canEditPlaylist,
  busy,
  onSelectAll,
  onExit,
  onCopy,
  onMove,
  onRemove,
}) {
  const nothingSelected = count === 0
  const allSelected = total > 0 && count === total

  return (
    <div
      role="region"
      aria-label="Selection actions"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-gray-700 bg-gray-800 px-3 pt-1 shadow-[0_-8px_24px_rgba(0,0,0,0.45)] pb-[max(0.5rem,env(safe-area-inset-bottom))] md:hidden"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center">
          <button
            type="button"
            onClick={onExit}
            className="rounded-md p-2 text-gray-300 active:bg-gray-700"
            aria-label="Exit selection"
          >
            <XMarkIcon className="h-5 w-5" aria-hidden="true" />
          </button>
          <span className="truncate text-sm font-medium text-white" aria-live="polite">
            {nothingSelected ? 'Tap items to select' : `${count} selected`}
          </span>
        </div>
        <button
          type="button"
          onClick={onSelectAll}
          disabled={total === 0}
          className="shrink-0 rounded-md px-2 py-2 text-sm font-medium text-indigo-400 active:bg-gray-700 disabled:opacity-40"
        >
          {allSelected ? 'Deselect all' : 'Select all'}
        </button>
      </div>
      <div className="flex gap-1">
        <BarButton icon={DocumentDuplicateIcon} label="Copy" onClick={onCopy} disabled={nothingSelected || busy} />
        {canEditPlaylist && (
          <>
            <BarButton icon={FolderArrowDownIcon} label="Move" onClick={onMove} disabled={nothingSelected || busy} />
            <BarButton icon={TrashIcon} label="Remove" onClick={onRemove} disabled={nothingSelected || busy} tone="danger" />
          </>
        )}
      </div>
    </div>
  )
}
