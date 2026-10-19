// src/app/api/authenticated/admin/logs/route.ts
// One media processor's own log, for the admin Logs page.
//
// The processor answers GET /api/logs only to a webhook ID or an admin
// session, so the browser never calls it directly (it used to, and the
// endpoint answered anyone). This route checks the admin, then forwards
// their session token server to server and passes the processor's answer on.
//
//   GET ?server=<id>&limit=&category=&level=&q=&before=&after=
// The processor validates every parameter; see its routes/logs.mjs.
import { NextResponse } from 'next/server'
import { isAdmin } from '@src/utils/routeAuth'
import { getBackendAuthHeaders } from '@src/utils/backendAuth'
import { getAllServers } from '@src/utils/config'

const FORWARDED_PARAMS = ['limit', 'category', 'level', 'q', 'before', 'after']
const UPSTREAM_TIMEOUT_MS = 20_000

export async function GET(request: Request) {
  const admin = await isAdmin()
  if (admin instanceof Response) return admin

  const params = new URL(request.url).searchParams
  const serverId = params.get('server')
  const server = getAllServers().find((candidate: { id: string }) => candidate.id === serverId)
  if (!server) {
    return NextResponse.json({ error: `Unknown server: ${serverId ?? '(none given)'}` }, { status: 400 })
  }
  const processorUrl: string | undefined = server.internalEndpoint || server.syncEndpoint
  if (!processorUrl) {
    return NextResponse.json({ error: `Server ${server.id} has no media processor URL` }, { status: 500 })
  }

  const query = new URLSearchParams()
  for (const name of FORWARDED_PARAMS) {
    const value = params.get(name)
    if (value !== null) query.set(name, value)
  }

  let upstream: Response
  try {
    upstream = await fetch(`${processorUrl.replace(/\/+$/, '')}/api/logs?${query}`, {
      headers: { Accept: 'application/json', ...(await getBackendAuthHeaders(request)) },
      cache: 'no-store',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    })
  } catch (error) {
    return NextResponse.json(
      { error: `Media processor unreachable: ${error instanceof Error ? error.message : String(error)}` },
      { status: 502 }
    )
  }

  let body: { error?: string; message?: string } | null = null
  try {
    body = await upstream.json()
  } catch {
    return NextResponse.json({ error: `Media processor answered ${upstream.status} without JSON` }, { status: 502 })
  }

  // The admin's own session was checked above, so a 401/403 here means the
  // processor rejected the forwarded token. Report it as an upstream failure
  // so the page doesn't read it as its own session having ended.
  if (upstream.status === 401 || upstream.status === 403) {
    const reason = body?.message || body?.error || 'no reason given'
    return NextResponse.json(
      { error: `The media processor refused the request (${upstream.status}): ${reason}` },
      { status: 502 }
    )
  }

  return NextResponse.json(body, { status: upstream.status })
}
