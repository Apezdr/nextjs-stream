// src/app/api/authenticated/admin/media-queues/route.ts
// Live state of the download and processing queues (SABnzbd, Radarr, Sonarr,
// Tdarr) for the admin overview, in the one shape lib/mediaQueues defines.
// Upstream payloads never reach the browser: Tdarr's get-nodes alone carries
// every node's API key and path translators.
import { NextResponse } from 'next/server'
import { isAdmin } from '@src/utils/routeAuth'
import { getMediaQueues } from '@src/lib/mediaQueues/getMediaQueues'
import { createLogger } from '@src/lib/logger'

const log = createLogger('MediaQueuesRoute')

export async function GET() {
  // Authorize before any upstream request: those carry the services' API keys
  // and must never run for an anonymous caller.
  const admin = await isAdmin()
  if (admin instanceof Response) return admin

  try {
    return NextResponse.json(await getMediaQueues())
  } catch (error) {
    log.error({ err: error }, 'Failed to load media queues')
    return NextResponse.json({ error: 'Failed to load media queues' }, { status: 500 })
  }
}
