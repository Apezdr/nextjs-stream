import { getSession } from '@src/lib/cachedAuth'
import { getFlatRecentlyWatchedForUser } from '@src/utils/flatDatabaseUtils'
import { isValidWebhook, signedInGate } from '@src/lib/roles/gates'
import { libraryAccessFor } from '@src/lib/roles/libraryAccess'
import { userQueries } from '@src/lib/userQueries'

// Who the data is for: the user a file server names with its webhook ID, or
// the signed-in user. Their roles decide their library scope.
async function getViewer(request, isWebhook) {
  if (isWebhook) {
    const id = request.headers.get('X-Webhook-User-ID')
    if (!id) return null
    const user = await userQueries.findById(id, { _id: 1, role: 1, roles: 1 })
    return user ? { id, role: user.role, roles: user.roles } : null
  }
  const session = await getSession()
  return session?.user ?? null
}

async function handleRequest(request, params, isWebhook) {
  const viewer = await getViewer(request, isWebhook)
  const userID = viewer?.id

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
    const page = request?.query?.page || 1
    const limit = request?.query?.limit || 15
    // Flat collections replace the deprecated nested Movies/TV read path.
    // Same sanitizeRecord output shape (or null when no history) as before.
    // Only titles in the user's library scope
    const recentlyWatched = await getFlatRecentlyWatchedForUser({
      access: await libraryAccessFor(viewer),
      userId: userID,
      page: page,
      limit: limit,
    })
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

export async function GET(request, props) {
  const params = await props.params;
  const authResult = await signedInGate.route()
  if (authResult instanceof Response) {
    return authResult
  }

  return handleRequest(request, params, false)
}

export async function POST(request, props) {
  const params = await props.params;
  const isWebhook = await isValidWebhook(request)
  return handleRequest(request, params, isWebhook)
}
