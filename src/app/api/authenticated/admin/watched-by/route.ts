// src/app/api/authenticated/admin/watched-by/route.ts
// Who has watched a title, for the admin "Watched by" dialog on the movie and
// episode info pages. The same rows the page's "Watched by N" count reads, one
// entry per viewer, most recent first.
//
//   GET ?normalizedVideoId=<nid>[&mediaId=mid:…]
import { NextResponse } from 'next/server'
import { isAdmin } from '@src/utils/routeAuth'
import { listViewersByNormalizedId } from '@src/utils/flatDatabaseUtils'
import { createLogger } from '@src/lib/logger'

const log = createLogger('API.Admin.WatchedBy')

export async function GET(request: Request) {
  const admin = await isAdmin()
  if (admin instanceof Response) return admin

  const params = new URL(request.url).searchParams
  const normalizedVideoId = params.get('normalizedVideoId')
  if (!normalizedVideoId) {
    return NextResponse.json({ error: 'normalizedVideoId is required' }, { status: 400 })
  }
  const mediaId = params.get('mediaId') || null

  try {
    const viewers = await listViewersByNormalizedId(normalizedVideoId, mediaId)
    return NextResponse.json({ viewers })
  } catch (error) {
    log.error({ err: error, normalizedVideoId, mediaId }, 'Failed to list viewers')
    return NextResponse.json({ error: 'Failed to list viewers' }, { status: 500 })
  }
}
