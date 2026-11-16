# Account Deletion System

How an account, and the data stored with it, is deleted from this app.

## Overview

An account is deleted in one of three ways. All three record a **deletion
request** and run the same deletion (`src/utils/accountDeletion.js`).

| Who asks | Where | Request type | What happens |
|----------|-------|--------------|--------------|
| The user, signed in | `/account/delete` | `authenticated` | The server deletes the account 30 days later, unless the user cancels or an admin acts sooner |
| Anyone, by email address | `/privacy/delete-account` | `public` | The request waits for an admin, marked as unverified. Never automatic |
| An admin | The Users page's "Delete account" | `admin` | The request is recorded and run at once |

Two things this system does **not** do:

- **No email is sent.** The app has no mail set up. Notifications are in the app
  (the bell). No page or message may tell anyone to check their inbox.
- **A request by email address is not verified**, and so is never carried out
  automatically. Nothing proves the address belongs to whoever typed it: with a
  date on it, anyone could delete someone else's account by typing their
  address and waiting. See [The public form](#the-public-form).

A date shown to anyone must be one the server acts on. Earlier versions of the
pages counted down 30 days to a deletion nothing ran.

## Architecture

### Database collections

In the `Users` database:

1. **DeletionRequests** - one document per request
2. **DeletionAuditLog** - who did what to a request, and when

### Core components

1. **`src/utils/accountDeletion.js`** - creating, cancelling and running
   requests; the deletion's steps; the audit log
2. **`src/lib/scheduledDeletions.ts`** - the server's own hourly check: the
   reminders and the deletions that are due
   ([The automatic check](#the-automatic-check))
3. **`src/utils/deletionSchedule.js`** - the 30 days and the 7-day reminder, for
   the server and for the pages that state them
4. **`src/utils/deletionEmailService.js`** - the in-app notifications of the
   flow, to the account and to the admins (it sends no email, whatever its name)
5. **`src/utils/rateLimiter.js`** - in-memory limit on the public form
6. **API routes** - below
7. **Pages** - `/account/delete`, `/privacy/delete-account`,
   `/admin/deletion-requests`, and the dialog on `/admin/users`. They share
   `src/components/DeletionRequest/`. The app is dark whatever the device's
   theme is, so these components use no `dark:` variants (Tailwind's default
   ties those to the device's theme)

## A request

```js
{
  _id, userId, email,            // the account, and its address when the request was made (null if it had none)
  accountName,                   // requestType 'admin' only: the name of an account that had no email
  requestType,                   // 'authenticated' | 'public' | 'admin'
  status,                        // 'pending' | 'processing' | 'completed' | 'cancelled'
  reason, requestedAt,
  scheduledDeletionAt,           // 'authenticated' only: when the server carries it out
  reminderSentAt,                // the account was reminded (once)
  requestedBy,                   // the admin, for requestType 'admin'
  metadata: { clientIp },        // for requestType 'public'
  // once a deletion has started:
  startedAt, lastRunAt, lastRunBy, progress, deletionResults, lastError,
  lastRunAutomatic,              // the hourly check ran it, no admin
  automaticFailures,             // how many automatic runs stopped part-way
  runLeaseUntil,                 // a run holds the request until then
  completedAt, completedBy, completedAutomatically,
  // once cancelled:
  cancelledAt, cancelledBy, cancellationReason, supersededBy
}
```

`pending`: waiting, for its date (a signed-in user's request) or for an admin
(one from the public form); it can be cancelled, by the account or by an
admin, and an admin can carry it out before its date. `processing`: a deletion
has started; it can only be finished. `completed` only after the deletion's
last step.

An account has at most one open request (`pending` or `processing`).

## API endpoints

### Signed-in users

#### POST `/api/authenticated/account/delete-request`

Body `{ "reason": "optional, at most 500 characters" }`. Answers 409 when the
account already has an open request.

```json
{ "success": true, "data": { "requestId": "…", "status": "pending", "requestedAt": "…", "scheduledDeletionAt": "…" } }
```

#### GET `/api/authenticated/account/delete-request`

The user's newest request, whatever its status. `hasActiveRequest` is true
while it is `pending`. `scheduledDeletionAt` is the date the server deletes the
account, which the page shows; it is null for a request that waits for an
admin. `requestType` is `public` when it was made with the account's email on
the public form: the page then says so, since the account's owner may not have
asked.

```json
{
  "success": true,
  "data": {
    "hasActiveRequest": true,
    "request": { "id": "…", "status": "pending", "requestType": "authenticated", "requestedAt": "…", "scheduledDeletionAt": "…", "reason": "…", "canCancel": true }
  }
}
```

#### DELETE `/api/authenticated/account/delete-request?requestId=<id>`

Cancels the user's own `pending` request. Someone else's answers 404, as if it
did not exist.

### The public form

#### POST `/api/public/delete-request`

Body `{ "email": "…", "reason": "optional" }`. Limited to 3 requests an hour
per address the request came from, counted before the email is read.

A well-formed request always gets the same answer:

```json
{ "success": true, "message": "If an account uses that email address, its deletion request is now with the admins. No email is sent." }
```

A request is recorded only when the address has an account (matched whatever
its letters' case) with no open request. It is recorded as `pending`, type
`public`, with no date: the automatic check never carries it out. The account
is told in the app and can cancel it; the admins are told, and the Deletion
Requests page marks it "Public form, address not verified" and warns before
deleting.

**Keep the answer uniform.** No 404 for an unknown address, no 409 for one
already asked for, no status in the body, and no GET that looks a request up by
address: any of these tells a stranger who has an account here.
`__tests__/app/publicDeleteRequestRoute.test.js` holds this.

Why there is no verification step: verifying an address means sending it a
link, and the app sends no mail. If mail is ever set up, the place for a
verification step is between this route and the request becoming `pending`.

### Admins

#### GET `/api/authenticated/admin/deletion-requests`

The requests, newest first. Query: `page` (default 0), `limit` (default 20, at
most 100), `status`, `requestType`, `email`. Each request also carries
`canCancel`, `canExecute`, `waitingDays` (whole days a `pending` request has
waited) and `deletesAutomatically` (a `pending` request with a date: the server
carries it out by itself).

#### POST `/api/authenticated/admin/deletion-requests`

```json
{ "action": "cancel|execute|get-audit-logs", "requestId": "…", "reason": "optional, for cancel" }
```

`execute` runs a request that has not started (`pending`, before its date
too) and runs again one whose last run stopped part-way (`processing`). A run
that stops answers 500 with `code: "DELETION_INCOMPLETE"`; the request stays
`processing` and is run again with the same call. A request another run holds
at that moment answers 409 `DELETION_RUNNING`, and nothing is removed.

#### DELETE `/api/authenticated/admin/deletion-requests?action=bulk-cancel&requestIds=<id1,id2>`

Cancels up to 10 requests. No page uses it.

#### POST `/api/authenticated/admin/delete-account`

An admin deletes an account that did not ask to be deleted (the Users page's
"Delete account"). It records a request of type `admin` and runs it at once,
through the same deletion as every other request. Nobody is notified.

```json
{ "userId": "…", "confirmation": "what the admin typed into the dialog", "reason": "optional, kept with the request" }
```

The confirmation is the account's email. An account with no email (an old
sign-in whose provider gave no address: such accounts exist) is confirmed by
its name, and one with neither by its id: `src/utils/deletionConfirmation.js`,
one rule for the dialog and the route. The request's record names the account
the same way: `email`, or `accountName` with `email: null`, or the user id
alone.

Refused: a caller who is not an admin, a "View as" session (403 `VIEWING_AS`),
a missing or malformed user id (400 `INVALID_USER_ID`), an account that does
not exist (404 `USER_NOT_FOUND`), the admin's own account (403 `OWN_ACCOUNT`),
an admin's account (403 `TARGET_IS_ADMIN`), no confirmation (400
`CONFIRMATION_REQUIRED`) and one that is not the account's (400
`CONFIRMATION_MISMATCH`). A deletion that began and stopped answers 500
`DELETION_INCOMPLETE` with the `requestId` to run again from the Deletion
Requests page.

### better-auth's own endpoints are off

better-auth's admin plugin serves `POST /api/auth/admin/remove-user`, which
deletes the user, their sessions and their OAuth links and nothing else: the
rest of the account's data would stay behind with no account to find it by,
and no audit entry would be written. It is turned off
(`src/lib/authDisabledPaths.ts`, `disabledPaths` in `src/lib/auth.ts`) and
answers 404. better-auth's self-service `/delete-user` is off by default and
stays off. `__tests__/lib/authDisabledPaths.test.js` holds both, and fails if
anything in `src` calls `removeUser`.

## The automatic check

`src/lib/scheduledDeletions.ts`, started from `src/instrumentation.ts` when the
server starts: one check a minute after the start, then one an hour. Each check

1. reminds, in the app, the accounts whose date is 7 days away or less (once
   each: `reminderSentAt`), and
2. carries out the requests that are due: `pending`, type `authenticated`,
   `scheduledDeletionAt` passed. It runs the same deletion an admin's click
   does, in nobody's name: the audit entries have no person and
   `details.automatic: true`, and the admins get a notification.

What it never does (`isDueForAutomaticRun` in `src/utils/accountDeletion.js`,
checked again inside the run itself): carry out a request from the public
form, a request with no date, or take up a run an admin started.

The timer is only a heartbeat. What is due, and how far a deletion got, is in
the database on each request:

- A restart, or a missed hour, delays a deletion and never loses one.
- A deletion that stops part-way is taken up by the next check, up to 5 times
  (`MAX_AUTOMATIC_ATTEMPTS`, one notification to the admins each), then it
  waits for an admin's "Run again".
- One run at a time holds a request (`runLeaseUntil`, renewed after each step,
  ten minutes at most without progress). The check in two server processes, or
  the check and an admin, cannot both delete the same account; the loser
  removes nothing.
- A user who cancels in the same instant wins or loses in one database write:
  a cancelled request is never carried out.

This works because the app is one long-running Node server. On hosting where
no process stays alive between requests the timer would never tick, and
`runScheduledDeletions()` would need calling from outside on a schedule.

## How a deletion runs

The databases are standalone MongoDB servers, which refuse transactions, so a
deletion is a fixed sequence of steps (`DELETION_STEPS` in
`src/utils/accountDeletion.js`). Each step is safe to run again, a run does all
of them, and the request records how far it got.

While a request is `processing` it holds `progress` (the steps the latest run
finished), `deletionResults` (what every run has removed so far, per
collection) and, after a run that stopped, `lastError` (`step`, `message`,
`at`).

| Step | What it does | A stop here leaves |
|------|--------------|--------------------|
| `signOut` | Bans the account (better-auth then refuses it a session), deletes its sessions, the "View as" sessions it opened and its device codes, then drops its cached sessions | The account banned, signed out or not, all its data intact |
| `activity` | Watch history, the collection it was migrated from, presence, notifications, client error reports | Banned and signed out; some of these gone |
| `lists` | Its private lists and their titles, its titles in no list, its collaborator entries, its home-screen rows | As above, and some of its lists gone |
| `legacySignIn` | Its rows under the pre-better-auth names, where a database still has them | As above |
| `requests` | Closes its other open deletion requests | As above |
| `account` | Its OAuth links, then the user row, last of all | Its OAuth links gone; the user row may remain |

Every filter is built from the request's user id, which is checked before
anything is written: a request with a missing or malformed user id is refused.

### What is removed and what is kept

The pages tell people this in their own words
(`src/components/DeletionRequest/DeletionRequestForm.js`, the dialog on the
Users page). Change the lists there with the steps here.

**Removed**

- Users database: `user`, `session` (its own, and the "View as" sessions it
  opened as other users), `account`, `deviceCode`, `PlaylistVisibility`; and,
  where a database still has them, the pre-better-auth `AuthenticatedUsers`,
  `SSOAccounts` (and their `_backup` copies), `authSessions`, `usedTokens`
- Media database: `WatchHistory`, `PlaybackStatus`, `PlaybackPresence`,
  `Notifications`, `ClientErrorReports`, its private `Playlists` and the
  `Watchlist` titles in them, and its `Watchlist` titles that are in no list
- Its collaborator entry on other people's lists
- Redis: its cached sessions

**Kept**

- A list it owns that other people can open or change (not private, or with
  collaborators, or with a permission for everyone), with its titles. It stays
  without an owner and is named in the request's `deletionResults.keptSharedPlaylists`
- The titles it added to other people's lists (a title belongs to its list)
- `ArrRequests`: the Radarr/Sonarr activity log, with the name it held
- `DeletionRequests` and `DeletionAuditLog`: the record of the deletion, with
  the account's email
- The admins' notifications about the request, which name the account's email

A deleted person can sign in again later with the same Google or Discord
account. That makes a new, empty account.

## Notifications

In the app, never by email (`src/utils/deletionEmailService.js`):

| When | To | Links to |
|------|----|----------|
| A request is made | The account | `/account/delete` |
| A request is made | The admins | `/admin/deletion-requests` |
| 7 days or less before its date | The account | `/account/delete` |
| A request is cancelled | The account | `/account/delete` |
| A user's request is carried out, by an admin or automatically | The admins | `/admin/deletion-requests` |
| A deletion stops part-way | The admins | `/admin/deletion-requests` |

An admin's own deletion from the Users page notifies nobody. No notification
names the date itself: it is read days later and in another time zone than the
server's, so it says how the date is set and the page shows it.

## Audit log

Every action on a request is recorded in `DeletionAuditLog` with the action,
the time, who did it (null for the public form and for the automatic check,
whose entries carry `details.automatic`) and, for the public form, the address
the request came from. The Deletion Requests page shows it per request.

## Rate limiting

The public form: 3 requests an hour per address the request came from. The
limiter is in memory, per server process, and starts empty after a restart.

## Compliance notes

This is the technical side of a GDPR/CCPA erasure request; it is not legal
advice. Two things depend on the people running the instance, not on the code:

- **Timeliness.** GDPR expects a request to be answered within a month. A
  request made while signed in is carried out by the server after 30 days. A
  request from the public form is not: the Deletion Requests page shows how
  long each has waited, and the admins get a notification when one is made.
- **Requests by email address.** The admin decides whether a request from the
  public form is really from the account's owner.
