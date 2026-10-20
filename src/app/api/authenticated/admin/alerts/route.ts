// src/app/api/authenticated/admin/alerts/route.ts
// One media processor's log alerts (firing, and resolved in the last day),
// for the Logs page's alerts panel and the admin dashboard.
//
//   GET ?server=<id>  →  { processorId, active, recent, checkedAt }
// The processor answers only its own admins (see proxyToProcessor); a server
// you don't run answers 502 with `refused: true`.
import { proxyToProcessor } from '@src/utils/admin/processorProxy'

export async function GET(request: Request) {
  return proxyToProcessor(request, { path: '/api/alerts' })
}
