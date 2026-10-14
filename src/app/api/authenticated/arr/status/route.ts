// src/app/api/authenticated/arr/status/route.ts
// Radarr/Sonarr state for a page of watchlist cards: the admin status chips.
//
//   GET ?items=movie:603,tv:1399
import { NextResponse } from 'next/server'
import { requireArrAccess } from '@src/lib/arr/access'
import { MAX_STATUS_ITEMS, getArrStatuses, parseStatusItems } from '@src/lib/arr/status'
import { createLogger } from '@src/lib/logger'

const log = createLogger('ArrStatusRoute')

export async function GET(request: Request) {
  // Authorize before any upstream request: those carry the services' API keys.
  const actor = await requireArrAccess()
  if (actor instanceof Response) return actor

  const items = parseStatusItems(new URL(request.url).searchParams.get('items'))
  if (!items) {
    return NextResponse.json(
      {
        error: 'invalid_request',
        message: `items takes up to ${MAX_STATUS_ITEMS} comma-separated movie:<tmdbId> or tv:<tmdbId> keys.`,
      },
      { status: 400 }
    )
  }

  try {
    return NextResponse.json(await getArrStatuses(items, actor))
  } catch (error) {
    log.error({ err: error }, 'Failed to load Radarr/Sonarr status')
    return NextResponse.json({ error: 'internal', message: 'Failed to load Radarr/Sonarr status.' }, { status: 500 })
  }
}
