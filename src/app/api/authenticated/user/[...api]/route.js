import { auth } from 'src/lib/auth'
import { getRecentlyWatchedForUser } from 'src/utils/admin_frontend_database'
import isAuthenticated, { isValidWebhook } from 'src/utils/routeAuth'

async function getUserID(request, isWebhook) {
  if (isWebhook) {
    return request.headers.get('X-Webhook-User-ID')
  } else {
    const session = await auth()
    return session?.userId
  }
}

async function handleRequest(request, params, isWebhook) {
  const userID = await getUserID(request, isWebhook)

  if (!userID) {
    return new Response(JSON.stringify({ error: 'User ID not found' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const slugs = params.api // This is an array
  const fetchRecentlyWatched = slugs.includes('recently-watched')

  let response = {}

  if (fetchRecentlyWatched) {
    const recentlyWatched = await getRecentlyWatchedForUser(userID)
    response = recentlyWatched
  }

  // Ensure that at least one type of data is included
  if (!fetchRecentlyWatched) {
    return new Response(JSON.stringify({ error: 'No valid data type specified' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify(response), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

export async function GET(request, { params }) {
  const authResult = await isAuthenticated(request)
  if (authResult instanceof Response) {
    return authResult
  }

  return handleRequest(request, params, false)
}

export async function POST(request, { params }) {
  const isWebhook = await isValidWebhook(request)
  return handleRequest(request, params, isWebhook)
}
