'use client'

import Link from 'next/link'
import Image from 'next/image'
import { ArrowTopRightOnSquareIcon, LockClosedIcon, PencilSquareIcon } from '@heroicons/react/24/outline'
import ViewInLibraryButton from './ViewInLibraryButton'
import useMediaBrowserParams from './useMediaBrowserParams'
import { formatFileSize } from './mediaBrowserConfig'
import { isShowWebVisible, isWebVisible } from '@src/utils/mediaVisibility'
import { formatServerLabel } from '@src/utils/serverLabel'
import DeleteMediaButton from './DeleteMediaButton'

const FALLBACK_POSTER = '/sorry-image-not-available.jpg'

function ServerNames({ item, servers }) {
  const labels = new Map(servers.map(server => [server.id, server.displayName]))
  if (!item.serverIds?.length) return <span className="text-gray-400">Unassigned</span>
  return (
    <div className="flex flex-wrap gap-1">
      {item.serverIds.map(serverId => (
        <span key={serverId} className="rounded bg-sky-50 px-1.5 py-0.5 text-xs text-sky-700">
          {labels.get(serverId) || formatServerLabel(serverId)}
        </span>
      ))}
    </div>
  )
}

function Flags({ type, item }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {item.manualEntry && <span className="rounded bg-purple-100 px-1.5 py-0.5 text-xs font-medium text-purple-700">Manual</span>}
      {type === 'movie' && !item.hasVideo && <span className="rounded bg-yellow-100 px-1.5 py-0.5 text-xs font-medium text-yellow-700">No video</span>}
      {type === 'movie' && !isWebVisible(item) && <span className="rounded bg-gray-200 px-1.5 py-0.5 text-xs text-gray-700">Hidden</span>}
      {type === 'tv' && !isShowWebVisible(item) && <span className="rounded bg-gray-200 px-1.5 py-0.5 text-xs text-gray-700">Hidden</span>}
      {item.lockedCount > 0 && (
        <span className="inline-flex items-center gap-0.5 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700">
          <LockClosedIcon className="h-3 w-3" /> {item.lockedCount}
        </span>
      )}
    </div>
  )
}

function VideoAvailability({ type, item }) {
  if (type === 'movie') return item.hasVideo ? 'Available' : 'Missing'
  return item.hasVideo ? `${item.videoCount}/${item.episodeCount} episodes` : 'Missing'
}

function HdrFormats({ item }) {
  const formats = item.hdrValues || (item.hdr ? [item.hdr === true ? 'HDR' : item.hdr] : [])
  return formats.length > 0 ? formats.join(', ') : 'SDR / none'
}

function Actions({ type, item, basePath }) {
  return (
    <div className="flex items-center justify-end gap-3">
      <ViewInLibraryButton type={type} originalTitle={item.originalTitle} title={item.title} variant="icon" />
      <Link href={`${basePath}/${item.id}`} className="text-gray-400 hover:text-indigo-600" title={`Edit ${item.title}`}>
        <PencilSquareIcon className="h-5 w-5" />
        <span className="sr-only">Edit {item.title}</span>
      </Link>
      <DeleteMediaButton type={type} id={item.id} label={item.title} />
    </div>
  )
}

/**
 * Header cell that toggles sort direction on repeat clicks. Sorting runs
 * server-side via the URL, so it covers the whole collection rather than the
 * rows currently on screen.
 */
function SortableHeader({ sortKey, sort, dir, onSort, align = 'left', children }) {
  const active = sort === sortKey
  return (
    <th className={`px-4 py-3 ${align === 'right' ? 'text-right' : ''}`} aria-sort={active ? (dir === 'desc' ? 'descending' : 'ascending') : 'none'}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 uppercase hover:text-gray-900 ${active ? 'text-gray-900' : ''}`}
      >
        {children}
        <span aria-hidden="true" className={active ? '' : 'opacity-0 group-hover:opacity-40'}>
          {active ? (dir === 'desc' ? '\u2193' : '\u2191') : '\u2195'}
        </span>
      </button>
    </th>
  )
}

export default function MediaCollectionView({ type, items, view, gridSize, visibleColumns, servers, sort = 'title', dir = '' }) {
  const basePath = type === 'tv' ? '/admin/media/tv' : '/admin/media/movies'
  const show = (column) => visibleColumns.includes(column)
  const { pushParams } = useMediaBrowserParams()

  // Clicking the active column flips direction; a new column starts ascending.
  const handleSort = (key) => {
    const nextDir = sort === key && dir !== 'desc' ? 'desc' : 'asc'
    pushParams({ sort: key, dir: nextDir === 'asc' ? '' : 'desc', page: 1 })
  }
  const sortProps = { sort, dir, onSort: handleSort }

  if (!items?.length) {
    return <div className="rounded-lg border border-dashed border-gray-300 bg-white p-12 text-center text-gray-500">No {type === 'tv' ? 'TV shows' : 'movies'} found.</div>
  }

  if (view === 'grid') {
    return (
      <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${gridSize}px), 1fr))` }}>
        {items.map(item => (
          <article key={item.id} className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
            {show('poster') && (
              <Link href={`${basePath}/${item.id}`} className="relative block aspect-[2/3] overflow-hidden bg-gray-100">
                <Image src={item.posterURL || FALLBACK_POSTER} alt="" fill unoptimized sizes={`${gridSize}px`} className="object-cover" />
              </Link>
            )}
            <div className="space-y-3 p-3">
              <div>
                <Link href={`${basePath}/${item.id}`} className="font-semibold text-gray-900 hover:text-indigo-600">{item.title}</Link>
                {show('originalTitle') && item.originalTitle && <p className="truncate text-xs text-gray-400">{item.originalTitle}</p>}
              </div>
              <dl className="space-y-1 text-xs text-gray-600">
                {show(type === 'tv' ? 'years' : 'year') && <div className="flex justify-between gap-2"><dt>{type === 'tv' ? 'Years' : 'Year'}</dt><dd>{type === 'tv' ? item.years || '—' : item.year || '—'}</dd></div>}
                {show('server') && <div><dt className="mb-1">Server Name</dt><dd><ServerNames item={item} servers={servers} /></dd></div>}
                {show('quality') && <div className="flex justify-between"><dt>Quality</dt><dd>{item.quality || 'Unknown'}</dd></div>}
            {type === 'movie' && show('size') && <div className="flex justify-between"><dt>File Size</dt><dd>{formatFileSize(item.sizeBytes)}</dd></div>}
                {type === 'tv' && show('seasons') && <div className="flex justify-between"><dt>Seasons</dt><dd>{item.seasonCount}</dd></div>}
                {type === 'tv' && show('episodes') && <div className="flex justify-between"><dt>Episodes</dt><dd>{item.episodeCount}</dd></div>}
                {show('video') && <div className="flex justify-between gap-2"><dt>Video</dt><dd><VideoAvailability type={type} item={item} /></dd></div>}
                {show('hdr') && <div className="flex justify-between gap-2"><dt>HDR</dt><dd className="text-right"><HdrFormats item={item} /></dd></div>}
              </dl>
              {show('flags') && <Flags type={type} item={item} />}
              <Actions type={type} item={item} basePath={basePath} />
            </div>
          </article>
        ))}
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50"><tr className="text-left text-xs font-semibold uppercase text-gray-500">
          {show('poster') && <th className="px-4 py-3">Poster</th>}
          <SortableHeader sortKey="title" {...sortProps}>Title</SortableHeader>
          {show('originalTitle') && <th className="px-4 py-3">Original title</th>}
          {show(type === 'tv' ? 'years' : 'year') && (
            <SortableHeader sortKey="year" {...sortProps}>{type === 'tv' ? 'Years' : 'Year'}</SortableHeader>
          )}
          {show('server') && <SortableHeader sortKey="server" {...sortProps}>Server Name</SortableHeader>}
          {show('quality') && <SortableHeader sortKey="quality" {...sortProps}>Quality</SortableHeader>}
          {type === 'tv' && show('seasons') && <SortableHeader sortKey="seasons" {...sortProps}>Seasons</SortableHeader>}
          {type === 'tv' && show('episodes') && <SortableHeader sortKey="episodes" {...sortProps}>Episodes</SortableHeader>}
          {type === 'movie' && show('size') && <SortableHeader sortKey="size" {...sortProps}>File Size</SortableHeader>}
          {show('video') && <th className="px-4 py-3">Video</th>}
          {show('hdr') && <th className="px-4 py-3">HDR</th>}
          {show('flags') && <th className="px-4 py-3">Flags</th>}
          <th className="px-4 py-3 text-right">Actions</th>
        </tr></thead>
        <tbody className="divide-y divide-gray-100">
          {items.map(item => (
            <tr key={item.id} className="hover:bg-gray-50 [contain-intrinsic-size:0_68px] [content-visibility:auto]">
              {show('poster') && <td className="px-4 py-2"><Image src={item.posterURL || FALLBACK_POSTER} alt="" width={44} height={64} unoptimized className="h-16 w-11 rounded object-cover" /></td>}
              <td className="px-4 py-2"><Link href={`${basePath}/${item.id}`} className="font-medium text-gray-900 hover:text-indigo-600">{item.title}</Link></td>
              {show('originalTitle') && <td className="px-4 py-2 text-sm text-gray-500">{item.originalTitle || '—'}</td>}
              {show(type === 'tv' ? 'years' : 'year') && <td className="px-4 py-2 text-sm text-gray-600">{type === 'tv' ? item.years || '—' : item.year || '—'}</td>}
              {show('server') && <td className="px-4 py-2"><ServerNames item={item} servers={servers} /></td>}
              {show('quality') && <td className="px-4 py-2 text-sm font-medium text-gray-600">{item.quality || 'Unknown'}</td>}
          {type === 'movie' && show('size') && <td className="px-4 py-2 text-sm tabular-nums text-gray-600">{formatFileSize(item.sizeBytes)}</td>}
              {type === 'tv' && show('seasons') && <td className="px-4 py-2 text-sm text-gray-600">{item.seasonCount}</td>}
              {type === 'tv' && show('episodes') && <td className="px-4 py-2 text-sm text-gray-600">{item.episodeCount}</td>}
              {show('video') && <td className="px-4 py-2 text-sm text-gray-600"><VideoAvailability type={type} item={item} /></td>}
              {show('hdr') && <td className="px-4 py-2 text-sm text-gray-600"><HdrFormats item={item} /></td>}
              {show('flags') && <td className="px-4 py-2"><Flags type={type} item={item} /></td>}
              <td className="px-4 py-2"><Actions type={type} item={item} basePath={basePath} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}