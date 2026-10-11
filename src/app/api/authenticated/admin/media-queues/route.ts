// src/app/api/authenticated/admin/media-queues/route.ts
// Live state of the download and processing queues (SABnzbd, Radarr, Sonarr,
// Tdarr) for the admin overview, in the one shape lib/mediaQueues defines.
// Upstream payloads never reach the browser: Tdarr's get-nodes alone carries
// every node's API key and path translators.
//
//   GET                     every queue (answers shared briefly across tabs)
//   GET ?refresh=<service>  that one queue, asked again now (a card's refresh button)
import { NextResponse } from 'next/server'
import { isAdmin } from '@src/utils/routeAuth'
import { getMediaQueues, refreshMediaQueue } from '@src/lib/mediaQueues/getMediaQueues'
import { MEDIA_QUEUE_SERVICES, type MediaQueueService } from '@src/lib/mediaQueues/types'
import { createLogger } from '@src/lib/logger'

const log = createLogger('MediaQueuesRoute')

const isService = (value: string): value is MediaQueueService =>
  (MEDIA_QUEUE_SERVICES as readonly string[]).includes(value)

export async function GET(request: Request) {
  // Authorize before any upstream request: those carry the services' API keys
  // and must never run for an anonymous caller.
  const admin = await isAdmin()
  if (admin instanceof Response) return admin

  const refresh = new URL(request.url).searchParams.get('refresh')
  if (refresh !== null && !isService(refresh)) {
    return NextResponse.json({ error: 'Unknown media queue' }, { status: 400 })
  }

  try {
    return NextResponse.json(refresh === null ? await getMediaQueues() : await refreshMediaQueue(refresh))
  } catch (error) {
    log.error({ err: error }, 'Failed to load media queues')
    return NextResponse.json({ error: 'Failed to load media queues' }, { status: 500 })
  }
}
