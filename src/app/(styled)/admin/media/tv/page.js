import { redirect } from 'next/navigation'
import { withApprovedUser } from '@components/HOC/ApprovedUser'
import { getSession } from '@src/lib/cachedAuth'
import { adminUserEmails } from '@src/utils/config'
import { listAdminTVShows } from '@src/utils/admin/flatMediaAdmin'
import { getServersWithDisplayNames } from '@src/utils/serverDisplayNames'
import MediaBrowser from '@components/Admin/Media/MediaBrowser'

async function TVAdminPage({ searchParams }) {
  const session = await getSession()
  if (!session?.user?.email || !adminUserEmails.includes(session.user.email)) {
    return redirect('/', 'replace')
  }

  const sp = (await searchParams) || {}
  const q = typeof sp.q === 'string' ? sp.q : ''
  const sort = typeof sp.sort === 'string' ? sp.sort : 'title'
  const page = parseInt(sp.page, 10) || 1
  const servers = (await getServersWithDisplayNames()).map(({ id, displayName }) => ({ id, displayName }))
  const requestedServer = typeof sp.server === 'string' ? sp.server : ''
  const serverId = servers.length > 1 && servers.some(server => server.id === requestedServer)
    ? requestedServer
    : ''
  const quality = typeof sp.quality === 'string' ? sp.quality : ''
  const year = typeof sp.year === 'string' ? sp.year : ''
  const video = typeof sp.video === 'string' ? sp.video : ''
  const hdr = typeof sp.hdr === 'string' ? sp.hdr : ''
  const size = typeof sp.size === 'string' ? sp.size : ''
  const dir = sp.dir === 'desc' ? 'desc' : ''

  const { items, total, page: resolvedPage, pageSize } = await listAdminTVShows({ search: q, page, pageSize: size, sort, dir, serverId, quality, year, video, hdr })

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="mb-6 text-2xl font-semibold text-gray-900">TV Shows</h1>
      <MediaBrowser type="tv" items={items} total={total} page={resolvedPage} pageSize={pageSize} q={q} sort={sort} dir={dir} servers={servers} serverId={serverId} quality={quality} year={year} video={video} hdr={hdr} />
    </div>
  )
}

export default withApprovedUser(TVAdminPage)
