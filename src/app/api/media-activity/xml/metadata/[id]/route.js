import {
  buildSessionMetadataXml,
  getActiveMediaSessionsOrUnavailable,
  unauthorizedMediaActivityResponse,
  validateMediaActivityRequest,
  xmlResponse,
} from '@src/utils/mediaActivity'

export async function GET(request, { params }) {
  const auth = await validateMediaActivityRequest(request)
  if (!auth.isValid) return unauthorizedMediaActivityResponse()

  const { id } = await params
  const payload = await getActiveMediaSessionsOrUnavailable(request)
  const session = payload.sessions.find((item) => item.id === id)

  return xmlResponse(buildSessionMetadataXml(session))
}