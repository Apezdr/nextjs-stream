import {
  unauthorizedMediaActivityResponse,
  validateMediaActivityRequest,
  xmlResponse,
} from '@src/utils/mediaActivity'

export async function GET(request) {
  const auth = await validateMediaActivityRequest(request)
  if (!auth.isValid) return unauthorizedMediaActivityResponse()

  return xmlResponse('<MediaContainer friendlyName="NextJS Stream" machineIdentifier="nextjs-stream" />')
}