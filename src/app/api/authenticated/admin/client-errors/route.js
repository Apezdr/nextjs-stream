/**
 * /api/authenticated/admin/client-errors
 *
 * Admin-only API backing the /admin/client-errors page.
 *
 * GET  ?view=groups (default) — error groups by dedupeKey + stats
 *      &severity=fatal|error|warning &category=... &platform=... &page= &limit=
 * GET  ?view=reports&dedupeKey=... — raw reports for one group
 * DELETE ?dedupeKey=... — delete one group; ?all=true — delete everything
 */

import { NextResponse } from 'next/server'
import { isAdmin } from '@src/utils/routeAuth'
import {
  getClientErrorGroups,
  getClientErrorReports,
  getClientErrorStats,
  deleteClientErrorReports,
} from '@src/utils/clientErrorReports/database'
import { createLogger } from '@src/lib/logger'

const log = createLogger('API.Admin.ClientErrors')

export async function GET(request) {
  try {
    const admin = await isAdmin(request)
    if (admin instanceof Response) {
      return admin
    }

    const { searchParams } = new URL(request.url)
    const view = searchParams.get('view') || 'groups'
    const page = parseInt(searchParams.get('page') || '1', 10)
    const limit = parseInt(searchParams.get('limit') || '25', 10)

    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
      return NextResponse.json({ error: 'Invalid pagination parameters' }, { status: 400 })
    }

    if (view === 'reports') {
      const dedupeKey = searchParams.get('dedupeKey')
      if (!dedupeKey) {
        return NextResponse.json(
          { error: 'dedupeKey is required for the reports view' },
          { status: 400 }
        )
      }

      const { reports, pagination } = await getClientErrorReports({ dedupeKey, page, limit })
      return NextResponse.json({ success: true, data: { reports, pagination } })
    }

    if (view !== 'groups') {
      return NextResponse.json({ error: 'view must be "groups" or "reports"' }, { status: 400 })
    }

    const severity = searchParams.get('severity') || null
    const category = searchParams.get('category') || null
    const platform = searchParams.get('platform') || null

    const [{ groups, pagination }, stats] = await Promise.all([
      getClientErrorGroups({ severity, category, platform, page, limit }),
      getClientErrorStats(),
    ])

    return NextResponse.json({ success: true, data: { groups, pagination, stats } })
  } catch (error) {
    log.error({ error }, 'Failed to fetch client error reports')
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

export async function DELETE(request) {
  try {
    const admin = await isAdmin(request)
    if (admin instanceof Response) {
      return admin
    }

    const { searchParams } = new URL(request.url)
    const dedupeKey = searchParams.get('dedupeKey')
    const all = searchParams.get('all') === 'true'

    if (!dedupeKey && !all) {
      return NextResponse.json(
        { error: 'Provide dedupeKey to delete a group, or all=true to clear everything' },
        { status: 400 }
      )
    }

    const deletedCount = await deleteClientErrorReports({ dedupeKey, all })

    log.info({ admin: admin.email, dedupeKey, all, deletedCount }, 'Admin deleted client error reports')

    return NextResponse.json({ success: true, data: { deletedCount } })
  } catch (error) {
    log.error({ error }, 'Failed to delete client error reports')
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
