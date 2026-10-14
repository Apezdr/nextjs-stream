// src/app/api/authenticated/arr/titles/[mediaType]/[tmdbId]/episodes/route.ts
// A show's episodes as Sonarr numbers them, for picking which to get. TMDB
// numbers some shows differently, so the picker never uses TMDB's list.
//
//   GET   { seriesId, ready, episodes }; `ready` is false while Sonarr is still
//         refreshing a show it has just added
import { NextResponse } from 'next/server'
import { requireArrAccess } from '@src/lib/arr/access'
import { ArrRequestError, arrErrorResponse, getArrEpisodes, parseTitleRef } from '@src/lib/arr/titles'

type Context = { params: Promise<{ mediaType: string; tmdbId: string }> }

export async function GET(request: Request, { params }: Context) {
  const user = await requireArrAccess()
  if (user instanceof Response) return user
  try {
    const ref = parseTitleRef(await params)
    if (ref.mediaType !== 'tv') throw new ArrRequestError(400, 'invalid_request', 'Only shows have episodes.')
    const title = new URL(request.url).searchParams.get('title')?.slice(0, 200) || null
    return NextResponse.json(await getArrEpisodes(ref.tmdbId, title))
  } catch (error) {
    return arrErrorResponse(error, 'sonarr')
  }
}
