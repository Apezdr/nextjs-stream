import { isAuthenticatedAndApproved } from '@src/utils/routeAuth'
import {
  addPlaylistToHomeScreens,
  HomeRowsError,
  isGlobalAdminUser,
  listHomeRowPeople,
  listPeopleWithRowCounts,
  removePlaylistFromHomeScreens,
} from '@src/utils/watchlist/homeRows'
import { invalidateHomeRows } from '@src/utils/watchlist/homeRowsCache'

/**
 * Admin: home screen rows across people.
 *
 * GET  /api/authenticated/home-rows/people                 everyone, with how many rows they have
 * GET  /api/authenticated/home-rows/people?playlistId=…    everyone, with where that playlist
 *                                                          stands on their home screen
 * POST /api/authenticated/home-rows/people
 *      { playlistId, action: 'add' | 'remove', userIds: [...] | everyone: true, position?: 'top' | 'bottom' }
 *      "everyone" is spelled out rather than implied by leaving userIds off,
 *      so a request that forgets its list changes nobody.
 */
export async function GET(req) {
  const admin = await requireAdmin(req)
  if (admin instanceof Response) return admin

  const playlistId = new URL(req.url).searchParams.get('playlistId')
  try {
    if (!playlistId) return Response.json({ people: await listPeopleWithRowCounts() })
    return Response.json(await listHomeRowPeople(playlistId))
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(req) {
  const admin = await requireAdmin(req)
  if (admin instanceof Response) return admin

  let body
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'The request body must be JSON' }, { status: 400 })
  }

  const { playlistId, action, userIds, everyone, position = 'top' } = body || {}
  if (action !== 'add' && action !== 'remove') {
    return Response.json({ error: "action must be 'add' or 'remove'" }, { status: 400 })
  }
  if (everyone !== true && !Array.isArray(userIds)) {
    return Response.json({ error: 'Send userIds, or everyone: true' }, { status: 400 })
  }
  const targets = everyone === true ? null : userIds

  try {
    if (action === 'add') {
      const result = await addPlaylistToHomeScreens(playlistId, { userIds: targets, position })
      invalidateHomeRows(result.added)
      return Response.json({ success: true, ...result })
    }
    const result = await removePlaylistFromHomeScreens(playlistId, { userIds: targets })
    invalidateHomeRows(result.removed)
    return Response.json({ success: true, ...result })
  } catch (error) {
    return errorResponse(error)
  }
}

async function requireAdmin(req) {
  const user = await isAuthenticatedAndApproved(req)
  if (user instanceof Response) return user
  if (!isGlobalAdminUser(user)) return Response.json({ error: 'Admins only' }, { status: 403 })
  return user
}

function errorResponse(error) {
  if (error instanceof HomeRowsError) return Response.json({ error: error.message }, { status: error.status })
  console.error('[home-rows/people]', error)
  return Response.json({ error: 'Home screen rows could not be loaded or changed' }, { status: 500 })
}
