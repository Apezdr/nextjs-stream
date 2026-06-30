import Link from 'next/link'
import { PencilSquareIcon, LockClosedIcon } from '@heroicons/react/24/outline'
import DeleteMediaButton from './DeleteMediaButton'

const FALLBACK_POSTER = '/sorry-image-not-available.jpg'

/**
 * Server-rendered media list table (movies or TV shows).
 * Rows link to the editor; delete is a client island per row.
 */
export default function MediaTable({ type, items }) {
  const basePath = type === 'tv' ? '/admin/media/tv' : '/admin/media/movies'

  if (!items || items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-gray-300 bg-white p-12 text-center text-gray-500">
        No {type === 'tv' ? 'TV shows' : 'movies'} found.
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr className="text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
            <th className="px-4 py-3">Poster</th>
            <th className="px-4 py-3">Title</th>
            {type === 'tv' ? (
              <>
                <th className="px-4 py-3">Years</th>
                <th className="px-4 py-3">Seasons</th>
                <th className="px-4 py-3">Episodes</th>
              </>
            ) : (
              <th className="px-4 py-3">Year</th>
            )}
            <th className="px-4 py-3">Flags</th>
            <th className="px-4 py-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {items.map((item) => (
            <tr key={item.id} className="hover:bg-gray-50">
              <td className="px-4 py-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={item.posterURL || FALLBACK_POSTER}
                  alt=""
                  className="h-16 w-11 rounded object-cover bg-gray-100"
                />
              </td>
              <td className="px-4 py-2">
                <Link href={`${basePath}/${item.id}`} className="font-medium text-gray-900 hover:text-indigo-600">
                  {item.title}
                </Link>
                {item.originalTitle && item.originalTitle !== item.title && (
                  <p className="text-xs text-gray-400">orig: {item.originalTitle}</p>
                )}
              </td>
              {type === 'tv' ? (
                <>
                  <td className="px-4 py-2 text-sm text-gray-600">{item.years || '—'}</td>
                  <td className="px-4 py-2 text-sm tabular-nums text-gray-600">{item.seasonCount}</td>
                  <td className="px-4 py-2 text-sm tabular-nums text-gray-600">{item.episodeCount}</td>
                </>
              ) : (
                <td className="px-4 py-2 text-sm text-gray-600">{item.year || '—'}</td>
              )}
              <td className="px-4 py-2">
                <div className="flex flex-wrap items-center gap-1">
                  {item.manualEntry && (
                    <span className="rounded bg-purple-100 px-1.5 py-0.5 text-xs font-medium text-purple-700">
                      Manual
                    </span>
                  )}
                  {type === 'movie' && !item.hasVideo && (
                    <span className="rounded bg-yellow-100 px-1.5 py-0.5 text-xs font-medium text-yellow-700">
                      No video
                    </span>
                  )}
                  {item.lockedCount > 0 && (
                    <span className="inline-flex items-center gap-0.5 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700">
                      <LockClosedIcon className="h-3 w-3" />
                      {item.lockedCount}
                    </span>
                  )}
                </div>
              </td>
              <td className="px-4 py-2">
                <div className="flex items-center justify-end gap-3">
                  <Link
                    href={`${basePath}/${item.id}`}
                    className="text-gray-400 hover:text-indigo-600"
                    title={`Edit ${item.title}`}
                  >
                    <PencilSquareIcon className="h-5 w-5" />
                    <span className="sr-only">Edit {item.title}</span>
                  </Link>
                  <DeleteMediaButton type={type} id={item.id} label={item.title} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
