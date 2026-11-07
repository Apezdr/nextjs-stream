// src/lib/viewAsAudit.ts
// The record of every "View as": each start and stop, with the admin's and
// the viewed user's ids (never an email or a name), from auth.ts's after hook.
// A refused start or stop is logged too, with better-auth's reason.
//
// Read from what the endpoint left on its context (better-auth 1.7.15, see
// node_modules/better-auth/dist/plugins/admin/routes.mjs):
// - /admin/impersonate-user: session is the admin's (its admin middleware set
//   it); newSession is the one it opened for the user, impersonatedBy the admin
// - /admin/stop-impersonating: session is the view-as session it ended;
//   newSession is the admin's own, put back
// ctx.path is the endpoint's route pattern, not the request's path.

/** The paths audited, as a hook's ctx.path reports them. */
export const VIEW_AS_START_PATH = '/admin/impersonate-user'
export const VIEW_AS_STOP_PATH = '/admin/stop-impersonating'

interface HookSession {
  session?: { impersonatedBy?: string | null } | null
  user?: { id?: unknown } | null
}

/** The parts of better-auth's hook context the audit reads. */
export interface ViewAsHookContext {
  path?: string
  body?: { userId?: unknown } | null
  context?: {
    session?: HookSession | null
    newSession?: HookSession | null
    /** The endpoint's result, or the APIError it threw. */
    returned?: unknown
  } | null
}

/** The two pino methods used. */
export interface AuditLog {
  info(fields: Record<string, unknown>, message: string): void
  warn(fields: Record<string, unknown>, message: string): void
}

const idOf = (value: unknown) => (value === undefined || value === null || value === '' ? null : String(value))

/** better-auth's APIError carries the status and, in its body, a code. */
function refusalOf(returned: unknown) {
  if (!(returned instanceof Error)) return null
  const error = returned as Error & { status?: unknown; statusCode?: unknown; body?: { code?: unknown } }
  return {
    status: error.statusCode ?? error.status ?? null,
    code: typeof error.body?.code === 'string' ? error.body.code : null,
    reason: error.message,
  }
}

/** Logs a view-as start or stop; any other path is ignored. Never throws. */
export function auditViewAs(ctx: ViewAsHookContext, log: AuditLog): void {
  if (ctx.path !== VIEW_AS_START_PATH && ctx.path !== VIEW_AS_STOP_PATH) return
  try {
    const { session, newSession, returned } = ctx.context ?? {}
    const refused = refusalOf(returned)

    if (ctx.path === VIEW_AS_START_PATH) {
      const adminId = idOf(session?.user?.id)
      if (refused) {
        log.warn({ adminId, targetUserId: idOf(ctx.body?.userId), ...refused }, 'View as: start refused')
        return
      }
      log.info(
        {
          adminId: idOf(newSession?.session?.impersonatedBy) ?? adminId,
          targetUserId: idOf(newSession?.user?.id),
        },
        'View as: started'
      )
      return
    }

    // The view-as session the stop ended (or tried to)
    const adminId = idOf(session?.session?.impersonatedBy)
    if (refused) {
      // userId: whoever's session asked, which need not be a view-as one
      log.warn({ adminId, userId: idOf(session?.user?.id), ...refused }, 'View as: stop refused')
      return
    }
    log.info({ adminId: adminId ?? idOf(newSession?.user?.id), targetUserId: idOf(session?.user?.id) }, 'View as: stopped')
  } catch {
    // The audit never fails the request it records
  }
}
