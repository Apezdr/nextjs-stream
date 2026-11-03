import { withApprovedUser } from '@components/HOC/ApprovedUser'
import { listAdminMovies } from '@src/utils/admin/flatMediaAdmin'
import MediaToolbar from '@components/Admin/Media/MediaToolbar'
import MediaTable from '@components/Admin/Media/MediaTable'
import { adminGate } from '@src/lib/roles/gates'

async function MoviesAdminPage({ searchParams }) {
  await adminGate.page()

  const sp = (await searchParams) || {}
  const q = typeof sp.q === 'string' ? sp.q : ''
  const sort = typeof sp.sort === 'string' ? sp.sort : 'title'
  const page = parseInt(sp.page, 10) || 1

  const { items, total, pageSize } = await listAdminMovies({ search: q, page, sort })

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="mb-6 text-2xl font-semibold text-gray-900">Movies</h1>
      <MediaToolbar type="movie" total={total} page={page} pageSize={pageSize} q={q} sort={sort} />
      <MediaTable type="movie" items={items} />
    </div>
  )
}

export default withApprovedUser(MoviesAdminPage)
