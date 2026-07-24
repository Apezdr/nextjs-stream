/**
 * POST /api/authenticated/client-error
 *
 * Ingests error reports from external client apps (TV/mobile/web) per
 * docs/react-native-app/client-error-reporting-contract.md.
 *
 * - Session-authed (web cookie or RN Bearer token); user identity is derived
 *   from the session, never the payload.
 * - Rate-limited per user (error paths can loop on-device).
 * - Responds 204 No Content; the client treats this as fire-and-forget.
 * - severity=fatal reports raise an admin-only notification.
 */

import { NextResponse } from 'next/server'
import { isAuthenticatedAndApproved } from '@src/utils/routeAuth'
import rateLimiter, { createRateLimitHeaders } from '@src/utils/rateLimiter'
import { validateClientErrorReport } from '@src/utils/clientErrorReports/validation'
import { insertClientErrorReport } from '@src/utils/clientErrorReports/database'
import { notifyAdminsOfFatalClientError } from '@src/utils/clientErrorReports/adminNotifier'
import { createLogger } from '@src/lib/logger'

const log = createLogger('API.ClientError')

// Contract suggests 30 reports/user/hour, dropped with 429.
const MAX_REPORTS_PER_HOUR = 30
const RATE_WINDOW_MS = 60 * 60 * 1000
const MAX_BODY_CHARS = 100 * 1024

export async function POST(request) {
  try {
    const authResult = await isAuthenticatedAndApproved(request)
    if (authResult instanceof Response) {
      return authResult
    }

    const rateLimitResult = rateLimiter.isRateLimited(
      `client-error_${authResult.id}`,
      MAX_REPORTS_PER_HOUR,
      RATE_WINDOW_MS
    )
    if (rateLimitResult.isLimited) {
      return NextResponse.json(
        { error: 'Too many error reports. Please try again later.' },
        { status: 429, headers: createRateLimitHeaders(rateLimitResult) }
      )
    }

    // Reject oversized payloads before buffering when the client declares a
    // length; the post-read check below still covers absent/lying headers.
    const contentLength = parseInt(request.headers.get('content-length') || '0', 10)
    if (contentLength > MAX_BODY_CHARS) {
      return NextResponse.json({ error: 'Report payload too large' }, { status: 413 })
    }

    const rawBody = await request.text()
    if (rawBody.length > MAX_BODY_CHARS) {
      return NextResponse.json({ error: 'Report payload too large' }, { status: 413 })
    }

    let body
    try {
      body = JSON.parse(rawBody)
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const validation = validateClientErrorReport(body)
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 })
    }

    const report = await insertClientErrorReport({
      userId: authResult.id,
      userEmail: authResult.email || null,
      report: validation.report,
    })

    log.info(
      {
        userId: authResult.id,
        category: report.category,
        severity: report.severity,
        dedupeKey: report.dedupeKey,
        platform: report.app?.platform,
      },
      'Client error report ingested'
    )

    if (report.severity === 'fatal') {
      // The notifier swallows its own errors — a notification failure must
      // never turn the 204 into a 500.
      await notifyAdminsOfFatalClientError(report)
    }

    return new Response(null, { status: 204 })
  } catch (error) {
    log.error({ error }, 'Failed to ingest client error report')
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
