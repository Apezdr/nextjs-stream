// src/app/api/authenticated/arr/titles/[mediaType]/[tmdbId]/search/route.ts
// Search now for a title Radarr/Sonarr already has, monitoring it first.
//
//   POST { scope? }   shows: { type: 'all' } (default), { type: 'seasons', seasons },
//                     or { type: 'episodes', episodeIds }; movies ignore it
import { NextResponse } from 'next/server'
import { requireArrAccess } from '@src/lib/arr/access'
import { arrErrorResponse, parseScope, parseTitleRef, searchArrTitle } from '@src/lib/arr/titles'
import { serviceForMediaType, type ArrService } from '@src/lib/arr/types'

type Context = { params: Promise<{ mediaType: string; tmdbId: string }> }

export async function POST(request: Request, { params }: Context) {
  const actor = await requireArrAccess()
  if (actor instanceof Response) return actor
  let service: ArrService | null = null
  try {
    const ref = parseTitleRef(await params)
    service = serviceForMediaType(ref.mediaType)
    const body = (await request.json().catch(() => null)) as { scope?: unknown } | null
    const scope = ref.mediaType === 'tv' ? parseScope(body?.scope, { forAdd: false }) : { type: 'all' as const }
    const title = new URL(request.url).searchParams.get('title')?.slice(0, 200) || null
    // 202: the search is queued in the service, not finished.
    return NextResponse.json(await searchArrTitle(ref, scope, title, actor), { status: 202 })
  } catch (error) {
    return arrErrorResponse(error, service)
  }
}
