// src/app/api/authenticated/media-list/tv/route.ts
// GET: one page of the TV list, as TVListClient loads it on a filter, sort or
// page change. A GET, not the Server Action it was, for the reason in
// ../movie/route.ts: the "View as" guard refuses every Server Action.
//
//   GET ?page=&sortOrder=&genres=&hdrTypes=&resolutions=  (one key per value)
//     { items, totalCount, totalPages, currentPage, filterOptions, currentFilters }
//
// Same checks, same cache entries as the page's own call; the caller's own
// answer, so no-store (the proxy's default).
import { approvedGate } from '@src/lib/roles/gates'
import { libraryAccessFor } from '@src/lib/roles/libraryAccess'
import { createLogger } from '@src/lib/logger'
import { getCachedTVListData } from '@src/utils/cache/mediaListData'
import { listOptions, listRequestOptions } from '@src/utils/mediaListUtils/listRequest'

const log = createLogger('API.MediaList')

export async function GET(request: Request) {
  const user = await approvedGate.route()
  if (user instanceof Response) return user

  try {
    const { id: scopeId } = await libraryAccessFor(user)
    const options = listOptions(listRequestOptions(new URL(request.url).searchParams), user.id, scopeId)
    return Response.json(await getCachedTVListData(options))
  } catch (error) {
    log.error({ error: (error as Error)?.message }, 'TV list read failed')
    return Response.json({ error: 'Could not read the TV list' }, { status: 500 })
  }
}
