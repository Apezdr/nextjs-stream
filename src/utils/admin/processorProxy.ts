// src/utils/admin/processorProxy.ts
// Forwards an admin's request to one media processor, server to server, for
// the admin routes that read a processor's own data (its log, its alerts).
//
// The processor answers these only to its own admins: it checks the forwarded
// session against its own Users database, so this works for servers that
// share this frontend's auth database, and a peer server you don't run
// refuses it. That is deliberate: in a network of independently run servers a
// pairing key isn't admin access, and letting a peer read a server's log will
// be an explicit grant.
import { NextResponse } from 'next/server'
import { isAdmin } from '@src/utils/routeAuth'
import { getBackendAuthHeaders } from '@src/utils/backendAuth'
import { getAllServers } from '@src/utils/config'

const UPSTREAM_TIMEOUT_MS = 20_000

/**
 * GET `<processor><path>?<forwarded params>` for the server named by `?server=`,
 * as the signed-in admin. A 401/403 from the processor becomes a 502, so the
 * page doesn't read it as its own session ending.
 */
export async function proxyToProcessor(
  request: Request,
  { path, forward = [] }: { path: string; forward?: string[] }
): Promise<Response> {
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
  for (const name of forward) {
    const value = params.get(name)
    if (value !== null) query.set(name, value)
  }

  let upstream: Response
  try {
    upstream = await fetch(`${processorUrl.replace(/\/+$/, '')}${path}?${query}`, {
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

  if (upstream.status === 401 || upstream.status === 403) {
    const reason = body?.message || body?.error || 'no reason given'
    return NextResponse.json(
      { error: `The media processor refused the request (${upstream.status}): ${reason}`, refused: true },
      { status: 502 }
    )
  }

  return NextResponse.json(body, { status: upstream.status })
}
