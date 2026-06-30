import { getSession } from '@src/lib/cachedAuth'
import AuthGuard from '@src/components/MediaPages/DynamicPage/guards/AuthGuard'
import TVListView from '@src/components/MediaPages/DynamicPage/views/TVListView'

export default async function TVListPage({ searchParams }) {
  const _searchParams = (await searchParams) ?? {}
  const session = await getSession()

  return (
    <AuthGuard session={session} callbackUrl="/list/tv" variant="skeleton">
      <TVListView searchParams={_searchParams} session={session} />
    </AuthGuard>
  )
}
