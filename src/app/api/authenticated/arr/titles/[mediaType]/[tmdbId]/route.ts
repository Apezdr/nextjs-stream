// src/app/api/authenticated/arr/titles/[mediaType]/[tmdbId]/route.ts
// One title in Radarr (movie) or Sonarr (tv).
//
//   GET    its state for the dialog; a service that is unset or down is a state, not an error
//   POST   add it: { qualityProfileId, rootFolderPath?, folder?, minimumAvailability?, scope?, search? }
//   PATCH  change its quality profile: { qualityProfileId }
//
// Every method takes ?title=<display title>, which only helps Sonarr find a
// show its metadata has no TMDB mapping for.
import { NextResponse } from 'next/server'
import { requireArrAccess } from '@src/lib/arr/access'
import {
  addArrTitle,
  arrErrorResponse,
  getArrTitle,
  parseAddInput,
  parseProfileChange,
  parseTitleRef,
  updateArrTitle,
} from '@src/lib/arr/titles'
import { serviceForMediaType, type ArrService } from '@src/lib/arr/types'
import { createLogger } from '@src/lib/logger'
import { setComingSoonStatus } from '@src/utils/watchlist/database'
import { REVISION, bumpRevisionAfterResponse } from '@src/utils/changes/revisions'

const log = createLogger('ArrTitleRoute')

type Context = { params: Promise<{ mediaType: string; tmdbId: string }> }

const titleHint = (request: Request) => new URL(request.url).searchParams.get('title')?.slice(0, 200) || null

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    return null
  }
}

export async function GET(request: Request, { params }: Context) {
  // Authorize before any upstream request: those carry the services' API keys.
  const actor = await requireArrAccess()
  if (actor instanceof Response) return actor
  try {
    return NextResponse.json(await getArrTitle(parseTitleRef(await params), titleHint(request), actor))
  } catch (error) {
    return arrErrorResponse(error, null)
  }
}

export async function POST(request: Request, { params }: Context) {
  const actor = await requireArrAccess()
  if (actor instanceof Response) return actor
  let service: ArrService | null = null
  try {
    const ref = parseTitleRef(await params)
    service = serviceForMediaType(ref.mediaType)
    const result = await addArrTitle(ref, parseAddInput(await readJson(request)), titleHint(request), actor)

    // Everyone with the title on a watchlist sees it's on its way. The add has
    // already happened by now, so a failure here is reported, not fatal.
    let comingSoon = false
    if (!result.inLibrary) {
      try {
        await setComingSoonStatus({
          tmdbId: ref.tmdbId,
          mediaType: ref.mediaType,
          setBy: actor.userId,
          setByUsername: actor.userName,
          source: result.service,
        })
        comingSoon = true
        // Playlist rows show the Coming Soon flag: move their /changes stamp
        bumpRevisionAfterResponse(REVISION.PLAYLISTS)
      } catch (error) {
        log.error({ err: error, tmdbId: ref.tmdbId, mediaType: ref.mediaType }, 'Added, but not marked Coming Soon')
      }
    }
    return NextResponse.json({ ...result, comingSoon }, { status: 201 })
  } catch (error) {
    return arrErrorResponse(error, service)
  }
}

export async function PATCH(request: Request, { params }: Context) {
  const actor = await requireArrAccess()
  if (actor instanceof Response) return actor
  let service: ArrService | null = null
  try {
    const ref = parseTitleRef(await params)
    service = serviceForMediaType(ref.mediaType)
    return NextResponse.json(
      await updateArrTitle(ref, parseProfileChange(await readJson(request)), titleHint(request), actor)
    )
  } catch (error) {
    return arrErrorResponse(error, service)
  }
}
