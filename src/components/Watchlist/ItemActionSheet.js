'use client'

import {
  CheckCircleIcon,
  ChevronDoubleDownIcon,
  ChevronDoubleUpIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ClockIcon,
  DocumentDuplicateIcon,
  FolderArrowDownIcon,
  InformationCircleIcon,
  TrashIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline'
import BottomSheet, { SheetAction } from './BottomSheet'

function ReorderButton({ icon: Icon, label, description, onClick, busy }) {
  return (
    <button
      type="button"
      onClick={onClick ?? undefined}
      disabled={!onClick || busy}
      aria-label={description}
      className="flex flex-col items-center gap-1 rounded-lg bg-gray-700/60 py-2 text-xs font-medium text-gray-100 transition-colors active:bg-gray-600 disabled:opacity-35"
    >
      <Icon className="h-5 w-5" aria-hidden="true" />
      {label}
    </button>
  )
}

function describe(item) {
  const type = item.mediaType === 'movie' ? 'Movie' : item.mediaType === 'tv' ? 'TV Show' : null
  const year = item.releaseDate ? new Date(item.releaseDate).getFullYear() : null
  const availability = item.url ? 'Available now' : 'Not available yet'
  return [type, Number.isFinite(year) ? year : null, availability].filter(Boolean).join(' · ')
}

/**
 * The mobile version of a watchlist card's "…" menu: the same actions, gated by
 * the same permissions, as a bottom sheet instead of a dropdown anchored inside
 * a card that is too narrow to hold it. The card owns every handler; each one
 * either acts straight away or closes the sheet first (see useOverlayState).
 *
 * `reorder` (from PlaylistGrid, null when the order is locked or read-only)
 * adds Top/Up/Down/Bottom, standing in for drag-and-drop, which touch browsers
 * don't reliably support. Those keep the sheet open so an item can be walked
 * several places; the position readout tracks it.
 */
export default function ItemActionSheet({
  open,
  onClose,
  afterLeave,
  item,
  selected,
  canEditPlaylist,
  isAdmin,
  reorder,
  onView,
  onToggleSelect,
  onCopy,
  onMove,
  onRemove,
  onMarkComingSoon,
  onRemoveComingSoon,
}) {
  const iconClass = 'h-5 w-5'

  return (
    <BottomSheet open={open} onClose={onClose} afterLeave={afterLeave} title={item.title} description={describe(item)}>
      <div className="border-t border-gray-700 py-1">
        {item.url && (
          <SheetAction onClick={onView} icon={<InformationCircleIcon className={iconClass} />}>
            View details
          </SheetAction>
        )}
        <SheetAction onClick={onToggleSelect} icon={<CheckCircleIcon className={iconClass} />}>
          {selected ? 'Deselect' : 'Select'}
        </SheetAction>
        <SheetAction onClick={onCopy} icon={<DocumentDuplicateIcon className={iconClass} />}>
          Copy to playlist
        </SheetAction>
        {canEditPlaylist && (
          <>
            <SheetAction onClick={onMove} icon={<FolderArrowDownIcon className={iconClass} />}>
              Move to playlist
            </SheetAction>
            <SheetAction onClick={onRemove} tone="danger" icon={<TrashIcon className={iconClass} />}>
              Remove from watchlist
            </SheetAction>
          </>
        )}
        {reorder && (
          <div className="mt-1 border-t border-gray-700 px-4 pb-2 pt-3">
            <div className="flex items-baseline justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Rearrange</h3>
              <span className="text-xs text-gray-400" aria-live="polite">
                {reorder.position} of {reorder.total}
              </span>
            </div>
            <div className="mt-2 grid grid-cols-4 gap-2">
              <ReorderButton icon={ChevronDoubleUpIcon} label="Top" description="Move to top" onClick={reorder.moveToTop} busy={reorder.busy} />
              <ReorderButton icon={ChevronUpIcon} label="Up" description="Move up one" onClick={reorder.moveUp} busy={reorder.busy} />
              <ReorderButton icon={ChevronDownIcon} label="Down" description="Move down one" onClick={reorder.moveDown} busy={reorder.busy} />
              <ReorderButton icon={ChevronDoubleDownIcon} label="Bottom" description="Move to bottom" onClick={reorder.moveToBottom} busy={reorder.busy} />
            </div>
          </div>
        )}
        {/* Admin-only Coming Soon controls - only for unavailable items */}
        {isAdmin && !item.isAvailable && (
          <div className="mt-1 border-t border-gray-700 pt-1">
            {item.comingSoon ? (
              <SheetAction onClick={onRemoveComingSoon} tone="warning" icon={<XCircleIcon className={iconClass} />}>
                Remove &quot;Coming Soon&quot;
              </SheetAction>
            ) : (
              <SheetAction onClick={onMarkComingSoon} tone="accent" icon={<ClockIcon className={iconClass} />}>
                Mark as &quot;Coming Soon&quot;
              </SheetAction>
            )}
          </div>
        )}
      </div>
    </BottomSheet>
  )
}
