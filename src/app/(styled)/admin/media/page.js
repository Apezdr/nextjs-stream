import Link from 'next/link'
import { redirect } from 'next/navigation'
import { FilmIcon, TvIcon } from '@heroicons/react/24/outline'
import { withApprovedUser } from '@components/HOC/ApprovedUser'
import { getSession } from '@src/lib/cachedAuth'
import { adminUserEmails, organizrURL } from '@src/utils/config'
import { getLastSynced } from '@src/utils/admin_database'
import { listAdminMovies, listAdminTVShows } from '@src/utils/admin/flatMediaAdmin'
import SyncButton from '@components/Admin/Media/SyncButton'

function formatLastSync(timestamp) {
  if (!timestamp || Number.isNaN(Date.parse(timestamp))) return "Sync hasn't been run yet"
  return new Date(timestamp).toLocaleString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hour12: true,
  })
}

async function MediaOverviewPage() {
  const session = await getSession()
  if ((session && session.user && !adminUserEmails.includes(session.user.email)) || !session) {
    return redirect('/', 'replace')
  }

  const [movieList, tvList, lastSyncTime] = await Promise.all([
    listAdminMovies({ page: 1, pageSize: 1 }),
    listAdminTVShows({ page: 1, pageSize: 1 }),
    getLastSynced(),
  ])

  const cards = [
    {
      href: '/admin/media/movies',
      label: 'Movies',
      count: movieList.total,
      Icon: FilmIcon,
      color: 'text-sky-600',
    },
    {
      href: '/admin/media/tv',
      label: 'TV Shows',
      count: tvList.total,
      Icon: TvIcon,
      color: 'text-violet-600',
    },
  ]

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Media Library</h1>
          <p className="mt-1 text-sm text-gray-500">Last synced: {formatLastSync(lastSyncTime)}</p>
        </div>
        <div className="flex items-center gap-3">
          <SyncButton />
          {organizrURL && (
            <Link
              href={organizrURL}
              target="_blank"
              className="rounded-md border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
            >
              Organizr
            </Link>
          )}
        </div>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2">
        {cards.map(({ href, label, count, Icon, color }) => (
          <Link
            key={href}
            href={href}
            className="group flex items-center gap-4 rounded-lg border border-gray-200 bg-white p-6 shadow-sm transition hover:border-indigo-300 hover:shadow"
          >
            <Icon className={`h-10 w-10 ${color}`} />
            <div>
              <p className="text-sm font-medium text-gray-500 group-hover:text-indigo-600">{label}</p>
              <p className="text-3xl font-semibold tabular-nums text-gray-900">{count}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}

export default withApprovedUser(MediaOverviewPage)
