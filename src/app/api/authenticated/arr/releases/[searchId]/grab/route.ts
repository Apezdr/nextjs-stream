// src/app/api/authenticated/arr/releases/[searchId]/grab/route.ts
// Grab one release from a finished interactive search: the service sends it
// to its download client, and the title stays monitored.
//
//   POST { releaseId }   the id the search listed it under
import { NextResponse } from 'next/server'
import { requireArrAccess } from '@src/lib/arr/access'
import { grabPick, pickService } from '@src/lib/arr/picks'
import { ArrRequestError, arrErrorResponse } from '@src/lib/arr/titles'
import type { ArrService } from '@src/lib/arr/types'

type Context = { params: Promise<{ searchId: string }> }

const SEARCH_ID = /^[0-9a-f-]{36}$/

export async function POST(request: Request, { params }: Context) {
  const user = await requireArrAccess()
  if (user instanceof Response) return user
  let service: ArrService | null = null
  try {
    const { searchId } = await params
    if (!SEARCH_ID.test(searchId)) throw new ArrRequestError(400, 'invalid_request', 'That isn’t a search id.')
    service = pickService(searchId)
    const body = (await request.json().catch(() => null)) as { releaseId?: unknown } | null
    return NextResponse.json(await grabPick(searchId, body?.releaseId))
  } catch (error) {
    return arrErrorResponse(error, service)
  }
}
