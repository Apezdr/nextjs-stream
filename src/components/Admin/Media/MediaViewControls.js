'use client'

import {
  AdjustmentsHorizontalIcon,
  ListBulletIcon,
  Squares2X2Icon,
} from '@heroicons/react/24/outline'

export default function MediaViewControls({
  view,
  onViewChange,
  gridSize,
  onGridSizeChange,
  columns,
  visibleColumns,
  onToggleColumn,
  hasMultipleServers,
  groupBy,
  onGroupByChange,
  isPaginated = false,
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 border-y border-gray-200 py-3">
      <div className="inline-flex rounded-md border border-gray-300 bg-white p-0.5" role="group" aria-label="Media view">
        <button
          type="button"
          onClick={() => onViewChange('list')}
          aria-pressed={view === 'list'}
          title="List view"
          className={`rounded p-1.5 ${view === 'list' ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:bg-gray-100'}`}
        >
          <ListBulletIcon className="h-5 w-5" />
          <span className="sr-only">List view</span>
        </button>
        <button
          type="button"
          onClick={() => onViewChange('grid')}
          aria-pressed={view === 'grid'}
          title="Grid view"
          className={`rounded p-1.5 ${view === 'grid' ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:bg-gray-100'}`}
        >
          <Squares2X2Icon className="h-5 w-5" />
          <span className="sr-only">Grid view</span>
        </button>
      </div>

      {view === 'grid' && (
        <label className="flex min-w-48 flex-1 items-center gap-2 text-xs text-gray-600 sm:max-w-xs">
          <span>Smaller</span>
          <input
            type="range"
            min="140"
            max="300"
            step="20"
            value={gridSize}
            onChange={(event) => onGridSizeChange(Number(event.target.value))}
            aria-label="Grid item size"
            className="min-w-24 flex-1 accent-indigo-600"
          />
          <span>Larger</span>
        </label>
      )}

      <label className="flex items-center gap-2 text-sm text-gray-700">
        <span>Group by</span>
        <select value={groupBy} onChange={(event) => onGroupByChange(event.target.value)} className="rounded-md border border-gray-300 bg-white py-1.5 pl-3 pr-8 text-sm">
          <option value="">None</option>
          {hasMultipleServers && <option value="server">Server</option>}
          <option value="quality">Quality</option>
          <option value="year">Year</option>
          <option value="video">Video</option>
          <option value="hdr">HDR</option>
        </select>
      </label>
      {groupBy && isPaginated ? (
        // Grouping runs on the rows already fetched, not the whole library.
        <span className="text-xs text-gray-500">Groups cover the current page only</span>
      ) : null}

      <details className="relative ml-auto">
        <summary className="flex cursor-pointer list-none items-center gap-1 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
          <AdjustmentsHorizontalIcon className="h-4 w-4" /> Columns
        </summary>
        <div className="absolute right-0 z-30 mt-2 w-52 rounded-md border border-gray-200 bg-white p-3 shadow-lg">
          <p className="mb-2 text-xs font-semibold uppercase text-gray-400">Visible fields</p>
          <div className="space-y-2">
            {columns.map(column => (
              <label key={column.id} className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={visibleColumns.includes(column.id)}
                  onChange={() => onToggleColumn(column.id)}
                  className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                />
                {column.label}
              </label>
            ))}
          </div>
        </div>
      </details>
    </div>
  )
}