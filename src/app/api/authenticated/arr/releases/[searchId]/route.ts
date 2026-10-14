// src/app/api/authenticated/arr/releases/[searchId]/route.ts
// One interactive search, as the release picker polls it: still searching,
// done with its releases (no guids or links), or failed. 410 once expired.
//
//   GET
import { NextResponse } from 'next/server'
import { requireArrAccess } from '@src/lib/arr/access'
import { readPick } from '@src/lib/arr/picks'
import { ArrRequestError, arrErrorResponse } from '@src/lib/arr/titles'

type Context = { params: Promise<{ searchId: string }> }

const SEARCH_ID = /^[0-9a-f-]{36}$/

export async function GET(_request: Request, { params }: Context) {
  const actor = await requireArrAccess()
  if (actor instanceof Response) return actor
  try {
    const { searchId } = await params
    if (!SEARCH_ID.test(searchId)) throw new ArrRequestError(400, 'invalid_request', 'That isn’t a search id.')
    return NextResponse.json(readPick(searchId, actor))
  } catch (error) {
    return arrErrorResponse(error, null)
  }
}
