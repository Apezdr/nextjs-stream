import { getSession } from '@src/lib/cachedAuth'
import AuthGuard from '@src/components/MediaPages/DynamicPage/guards/AuthGuard'
import MovieListView from '@src/components/MediaPages/DynamicPage/views/MovieListView'

export default async function MovieListPage({ searchParams }) {
  const _searchParams = (await searchParams) ?? {}
  const session = await getSession()

  return (
    <AuthGuard session={session} callbackUrl="/list/movie" variant="skeleton">
      <MovieListView searchParams={_searchParams} session={session} />
    </AuthGuard>
  )
}
