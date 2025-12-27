import { getServerStatus } from '@src/utils/serverStatus'

export async function GET() {
  const status = await getServerStatus()
  return Response.json(status, { status: status.ok ? 200 : 503 })
}
