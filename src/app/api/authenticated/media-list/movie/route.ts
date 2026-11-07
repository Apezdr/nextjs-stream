// src/app/api/authenticated/media-list/movie/route.ts
// GET: one page of the movie list, as MovieListClient loads it on a filter,
// sort or page change. It was a Server Action; the "View as" guard refuses
// every Server Action (it can't tell a read from a write by the action's id),
// so while viewing as, paging and filtering failed. A GET passes it.
//
//   GET ?page=&sortOrder=&genres=&hdrTypes=&resolutions=  (one key per value)
//     { items, totalCount, totalPages, currentPage, filterOptions, currentFilters }
//
// The checks the page makes: approved, and only the caller's library scope,
// both from their session. The cached fetch gets the page's own arguments in
// the page's order (listRequest.js), so the two share cache entries. The
// answer is the caller's own (their watch history is joined onto it), so the
// proxy's no-store default stands.
import { approvedGate } from '@src/lib/roles/gates'
import { libraryAccessFor } from '@src/lib/roles/libraryAccess'
import { createLogger } from '@src/lib/logger'
import { getCachedMovieListData } from '@src/utils/cache/mediaListData'
import { listOptions, listRequestOptions } from '@src/utils/mediaListUtils/listRequest'

const log = createLogger('API.MediaList')

export async function GET(request: Request) {
  const user = await approvedGate.route()
  if (user instanceof Response) return user

  try {
    const { id: scopeId } = await libraryAccessFor(user)
    const options = listOptions(listRequestOptions(new URL(request.url).searchParams), user.id, scopeId)
    return Response.json(await getCachedMovieListData(options))
  } catch (error) {
    log.error({ error: (error as Error)?.message }, 'Movie list read failed')
    return Response.json({ error: 'Could not read the movie list' }, { status: 500 })
  }
}
