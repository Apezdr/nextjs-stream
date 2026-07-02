import {
  buildMediaActivitySummary,
  getActiveMediaSessionsOrUnavailable,
  unauthorizedMediaActivityResponse,
  validateMediaActivityRequest,
} from '@src/utils/mediaActivity'

export async function GET(request) {
  const auth = await validateMediaActivityRequest(request)
  if (!auth.isValid) return unauthorizedMediaActivityResponse()

  const payload = await getActiveMediaSessionsOrUnavailable(request)
  return Response.json(buildMediaActivitySummary(payload), {
    headers: { 'Cache-Control': 'private, no-store' },
  })
}