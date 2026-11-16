# Account Deletion System

How an account, and the data stored with it, is deleted from this app.

## Overview

An account is deleted in one of three ways. All three record a **deletion
request** and run the same deletion (`src/utils/accountDeletion.js`).

| Who asks | Where | Request type | What happens |
|----------|-------|--------------|--------------|
| The user, signed in | `/account/delete` | `authenticated` | The request waits for an admin |
| Anyone, by email address | `/privacy/delete-account` | `public` | The request waits for an admin, marked as unverified |
| An admin | The Users page's "Delete account" | `admin` | The request is recorded and run at once |

Three things this system does **not** do, which earlier versions of the code
and of this document claimed:

- **Nothing runs on a schedule.** There is no grace period, no countdown and no
  automatic deletion. A request waits until an admin deletes the account or
  cancels the request, on `/admin/deletion-requests`.
- **No email is sent.** The app has no mail set up. Notifications are in the app
  (the bell). No page or message may tell anyone to check their inbox.
- **A request by email address is not verified.** Nothing proves the address
  belongs to whoever typed it. See [The public form](#the-public-form).

## Architecture

### Database collections

In the `Users` database:

1. **DeletionRequests** - one document per request
2. **DeletionAuditLog** - who did what to a request, and when

### Core components

1. **`src/utils/accountDeletion.js`** - creating, cancelling and running
   requests; the deletion's steps; the audit log
2. **`src/utils/deletionEmailService.js`** - the in-app notifications of the
   flow, to the account and to the admins (it sends no email, whatever its name)
3. **`src/utils/rateLimiter.js`** - in-memory limit on the public form
4. **API routes** - below
5. **Pages** - `/account/delete`, `/privacy/delete-account`,
   `/admin/deletion-requests`, and the dialog on `/admin/users`. They share
   `src/components/DeletionRequest/`. The app is dark whatever the device's
   theme is, so these components use no `dark:` variants (Tailwind's default
   ties those to the device's theme)

## A request

```js
{
  _id, userId, email,            // the account, and its address when the request was made
  requestType,                   // 'authenticated' | 'public' | 'admin'
  status,                        // 'pending' | 'processing' | 'completed' | 'cancelled'
  reason, requestedAt,
  requestedBy,                   // the admin, for requestType 'admin'
  metadata: { clientIp },        // for requestType 'public'
  // once a deletion has started:
  startedAt, lastRunAt, lastRunBy, progress, deletionResults, lastError,
  completedAt, completedBy,
  // once cancelled:
  cancelledAt, cancelledBy, cancellationReason, supersededBy
}
```

`pending`: waiting for an admin; it can be cancelled, by the account or by an
admin. `processing`: a deletion has started; it can only be finished.
`completed` only after the deletion's last step.

An account has at most one open request (`pending` or `processing`).

## API endpoints

### Signed-in users

#### POST `/api/authenticated/account/delete-request`

Body `{ "reason": "optional, at most 500 characters" }`. Answers 409 when the
account already has an open request.

```json
{ "success": true, "data": { "requestId": "…", "status": "pending", "requestedAt": "…" } }
```

#### GET `/api/authenticated/account/delete-request`

The user's newest request, whatever its status. `hasActiveRequest` is true
while it is `pending`. `requestType` is `public` when it was made with the
account's email on the public form: the page then says so, since the account's
owner may not have asked.

```json
{
  "success": true,
  "data": {
    "hasActiveRequest": true,
    "request": { "id": "…", "status": "pending", "requestType": "authenticated", "requestedAt": "…", "reason": "…", "canCancel": true }
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
`public`; the account is told in the app and can cancel it; the admins are
told, and the Deletion Requests page marks it "Public form, address not
verified" and warns before deleting.

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
`canCancel`, `canExecute` and `waitingDays` (whole days a `pending` request has
waited).

#### POST `/api/authenticated/admin/deletion-requests`

```json
{ "action": "cancel|execute|get-audit-logs", "requestId": "…", "reason": "optional, for cancel" }
```

`execute` runs a request that has not started (`pending`) and runs again one
whose last run stopped part-way (`processing`). A run that stops answers 500
with `code: "DELETION_INCOMPLETE"`; the request stays `processing` and is run
again with the same call.

#### DELETE `/api/authenticated/admin/deletion-requests?action=bulk-cancel&requestIds=<id1,id2>`

Cancels up to 10 requests. No page uses it.

#### POST `/api/authenticated/admin/delete-account`

An admin deletes an account that did not ask to be deleted (the Users page's
"Delete account"). It records a request of type `admin` and runs it at once,
through the same deletion as every other request. Nobody is notified.

```json
{ "userId": "…", "email": "the account's email, as typed into the confirmation", "reason": "optional, kept with the request" }
```

Refused: a caller who is not an admin, a "View as" session (403 `VIEWING_AS`),
a missing or malformed user id (400 `INVALID_USER_ID`), an account that does
not exist (404 `USER_NOT_FOUND`), the admin's own account (403 `OWN_ACCOUNT`),
an admin's account (403 `TARGET_IS_ADMIN`), and an email that is not the
account's (400 `EMAIL_MISMATCH`). A deletion that began and stopped answers 500
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
| A request is cancelled | The account | `/account/delete` |
| A user's request is carried out | The admins | `/admin/deletion-requests` |
| A deletion stops part-way | The admins | `/admin/deletion-requests` |

An admin's own deletion from the Users page notifies nobody.

## Audit log

Every action on a request is recorded in `DeletionAuditLog` with the action,
the time, who did it (null for the public form) and, for the public form, the
address the request came from. The Deletion Requests page shows it per request.

## Rate limiting

The public form: 3 requests an hour per address the request came from. The
limiter is in memory, per server process, and starts empty after a restart.

## Compliance notes

This is the technical side of a GDPR/CCPA erasure request; it is not legal
advice. Two things depend on the people running the instance, not on the code:

- **Timeliness.** GDPR expects a request to be answered within a month. Nothing
  here enforces that: the Deletion Requests page shows how long each request
  has waited, and the admins get a notification when one is made.
- **Requests by email address.** The admin decides whether a request from the
  public form is really from the account's owner.
