import { getServerStatus } from '@src/utils/serverStatus'
import { connection } from 'next/server';

export async function GET() {
  await connection();
  const status = await getServerStatus()
  return Response.json(status, { status: status.ok ? 200 : 503 })
}
