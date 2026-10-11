import { getServerStatus } from '@src/utils/serverStatus'
import { connection } from 'next/server';

export async function GET() {
  await connection();
  const status = await getServerStatus()
  return Response.json(status, {
    status: status.ok ? 200 : 503,
    // The TV app's liveness probe: a stored answer would hide an outage. tvOS's
    // URL cache heuristically stores a 200 GET that carries no freshness
    // headers (see proxy.ts), and proxy.ts only defaults /api/authenticated/*.
    headers: { 'Cache-Control': 'no-store' },
  })
}
