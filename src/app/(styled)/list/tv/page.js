import { Suspense } from 'react'
import SessionGate from '@src/components/MediaPages/DynamicPage/guards/SessionGate'
import TVListView from '@src/components/MediaPages/DynamicPage/views/TVListView'
import MediaListPageSkeleton from '@components/MediaPages/MediaListPageSkeleton'

async function FilteredList({ searchParams, session }) {
  const _searchParams = (await searchParams) ?? {}
  return <TVListView searchParams={_searchParams} session={session} />
}

// See: https://nextjs.org/docs/app/guides/adopting-partial-prefetching
export const prefetch = 'partial'

// The session and the filters are read inside the boundary (see SessionGate),
// so the route has a prerendered shell a link can have ready before the click.
export default function TVListPage({ searchParams }) {
  return (
    <Suspense fallback={<MediaListPageSkeleton />}>
      <SessionGate callbackUrl={() => '/list/tv'}>
        {({ session }) => <FilteredList searchParams={searchParams} session={session} />}
      </SessionGate>
    </Suspense>
  )
}
