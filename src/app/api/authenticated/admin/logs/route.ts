// src/app/api/authenticated/admin/logs/route.ts
// One media processor's own log, for the admin Logs page.
//
// The processor answers GET /api/logs only to its own admins, so the browser
// never calls it directly (it used to, and the endpoint answered anyone).
// See proxyToProcessor for how the admin's session is forwarded.
//
//   GET ?server=<id>&limit=&only=&hide=&level=&q=&from=&to=&before=&after=
// The processor validates every parameter; see its routes/logs.mjs.
import { proxyToProcessor } from '@src/utils/admin/processorProxy'

const FORWARDED_PARAMS = ['limit', 'only', 'hide', 'level', 'q', 'from', 'to', 'before', 'after']

export async function GET(request: Request) {
  return proxyToProcessor(request, { path: '/api/logs', forward: FORWARDED_PARAMS })
}
