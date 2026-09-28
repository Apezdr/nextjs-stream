import { isAuthenticatedAndApproved } from '@src/utils/routeAuth'
import { getHomeRows, saveHomeRows, HomeRowsError, isGlobalAdminUser } from '@src/utils/watchlist/homeRows'
import { invalidateHomeRows } from '@src/utils/watchlist/homeRowsCache'

/**
 * Home screen rows: the playlists that show as rows on a person's home screen.
 *
 * GET  /api/authenticated/home-rows            your rows, and the playlists you could add
 * GET  /api/authenticated/home-rows?userId=…   someone else's (admins)
 * PUT  /api/authenticated/home-rows            { rows: [{ playlistId, appTitle, hideUnavailable }], userId? }
 *      replaces the rows, in order
 */
export async function GET(req) {
  const user = await isAuthenticatedAndApproved(req)
  if (user instanceof Response) return user

  const target = targetUser(user, new URL(req.url).searchParams.get('userId'))
  if (target instanceof Response) return target

  try {
    return Response.json(await getHomeRows(target))
  } catch (error) {
    return errorResponse(error)
  }
}

export async function PUT(req) {
  const user = await isAuthenticatedAndApproved(req)
  if (user instanceof Response) return user

  let body
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'The request body must be JSON' }, { status: 400 })
  }

  const target = targetUser(user, body?.userId)
  if (target instanceof Response) return target

  try {
    const result = await saveHomeRows(target, body?.rows)
    invalidateHomeRows([target])
    return Response.json({ success: true, ...result })
  } catch (error) {
    return errorResponse(error)
  }
}

// Your own rows, or someone else's if you're an admin
function targetUser(user, requestedId) {
  if (!requestedId || requestedId === user.id) return user.id
  if (!isGlobalAdminUser(user)) {
    return Response.json({ error: "Only an admin can see or change someone else's home screen rows" }, { status: 403 })
  }
  return requestedId
}

function errorResponse(error) {
  if (error instanceof HomeRowsError) return Response.json({ error: error.message }, { status: error.status })
  console.error('[home-rows]', error)
  return Response.json({ error: 'Home screen rows could not be loaded or saved' }, { status: 500 })
}
