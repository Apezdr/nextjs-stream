// src/app/api/authenticated/arr/titles/[mediaType]/[tmdbId]/releases/route.ts
// Pick a release by hand: starts the service's interactive search for a title
// it already has. The search runs on; poll /api/authenticated/arr/releases/<id>.
//
//   POST {}                        movie
//   POST { seasonNumber } | { episodeId }   show: a season, or one episode
import { NextResponse } from 'next/server'
import { requireArrAccess } from '@src/lib/arr/access'
import { parsePickTarget, startPick } from '@src/lib/arr/picks'
import { arrErrorResponse, parseTitleRef } from '@src/lib/arr/titles'
import { serviceForMediaType, type ArrService } from '@src/lib/arr/types'

type Context = { params: Promise<{ mediaType: string; tmdbId: string }> }

export async function POST(request: Request, { params }: Context) {
  // Authorize before any upstream request: those carry the services' API keys.
  const user = await requireArrAccess()
  if (user instanceof Response) return user
  let service: ArrService | null = null
  try {
    const ref = parseTitleRef(await params)
    service = serviceForMediaType(ref.mediaType)
    const pick = parsePickTarget(await request.json().catch(() => null), ref.mediaType)
    const title = new URL(request.url).searchParams.get('title')?.slice(0, 200) || null
    // 202: the search has started, not finished.
    return NextResponse.json(await startPick(ref, pick, title, user.id), { status: 202 })
  } catch (error) {
    return arrErrorResponse(error, service)
  }
}
