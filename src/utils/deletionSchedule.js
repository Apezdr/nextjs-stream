// src/utils/deletionSchedule.js
// The times of the account deletion flow, in one place for the server (which
// acts on them) and the pages (which state them). No imports: client
// components read this too.
//
// A request a user makes while signed in is carried out automatically
// DELETION_GRACE_DAYS after it was made, by the server's own hourly check
// (src/lib/scheduledDeletions.ts). Until then the user can cancel it. A
// request made on the public form has no such date: nobody proved the
// address was theirs, so it waits for an admin.

/** Days between a signed-in user's request and the automatic deletion of the account. */
export const DELETION_GRACE_DAYS = 30

/** How many days before that the account is reminded, in the app. */
export const DELETION_REMINDER_DAYS = 7

const DAY_MS = 24 * 60 * 60 * 1000

/** When a request made at `requestedAt` is carried out automatically. */
export function scheduledDeletionDate(requestedAt) {
  return new Date(new Date(requestedAt).getTime() + DELETION_GRACE_DAYS * DAY_MS)
}

/** The moment `days` days after `from`. */
export function daysAfter(from, days) {
  return new Date(new Date(from).getTime() + days * DAY_MS)
}
