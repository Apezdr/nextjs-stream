# Account Deletion System Implementation

This document describes the implementation of the GDPR/CCPA compliant account deletion system for the Next.js media streaming application.

## Overview

The account deletion system provides a comprehensive solution for users to request account deletion with proper verification, grace periods, and audit logging. It supports both authenticated users and public users (email-based verification).

## Architecture

### Database Collections

The system uses three main MongoDB collections in the `Users` database:

1. **DeletionRequests** - Stores account deletion requests
2. **DeletionAuditLog** - Tracks all actions performed on deletion requests
3. **DeletionVerificationTokens** - Stores email verification tokens for public requests

### Core Components

1. **Utility Functions** (`src/utils/accountDeletion.js`)
   - Account deletion request management
   - Data deletion across all collections
   - Audit logging
   - Token management

2. **Email Service** (`src/utils/deletionEmailService.js`)
   - Email notifications using the existing notification system
   - Deletion workflow notifications
   - Admin notifications

3. **Rate Limiter** (`src/utils/rateLimiter.js`)
   - In-memory rate limiting for public endpoints
   - Configurable limits for different operations

4. **API Routes**
   - Authenticated user endpoints
   - Public endpoints with email verification
   - Admin management endpoints

## API Endpoints

### Authenticated Users

#### POST `/api/authenticated/account/delete-request`
Create a new account deletion request for authenticated users.

**Request Body:**
```json
{
  "reason": "Optional reason for deletion"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Account deletion request created successfully",
  "data": {
    "requestId": "ObjectId",
    "status": "pending",
    "scheduledDeletionAt": "2024-01-30T00:00:00.000Z",
    "requestedAt": "2024-01-01T00:00:00.000Z"
  }
}
```

#### GET `/api/authenticated/account/delete-request`
Get deletion request status for authenticated user.

**Response:**
```json
{
  "success": true,
  "data": {
    "hasActiveRequest": true,
    "request": {
      "id": "ObjectId",
      "status": "pending",
      "requestType": "authenticated",
      "requestedAt": "2024-01-01T00:00:00.000Z",
      "scheduledDeletionAt": "2024-01-30T00:00:00.000Z",
      "reason": "User reason",
      "canCancel": true
    }
  }
}
```

#### DELETE `/api/authenticated/account/delete-request?requestId=<id>&reason=<reason>`
Cancel an existing deletion request.

### Public Users

#### POST `/api/public/delete-request`
Create a new account deletion request for public users (requires email verification).

**Request Body:**
```json
{
  "email": "user@example.com",
  "reason": "Optional reason for deletion"
}
```

**Rate Limiting:** 3 requests per hour per IP address

**Response:**
```json
{
  "success": true,
  "message": "Account deletion request created. Please check your email to verify the request.",
  "data": {
    "requestId": "ObjectId",
    "status": "pending_verification",
    "email": "user@example.com",
    "verificationRequired": true,
    "verificationExpiresAt": "2024-01-02T00:00:00.000Z"
  }
}
```

#### GET `/api/public/delete-request?email=<email>`
Get deletion request status for public users.

**Rate Limiting:** 10 requests per hour per IP address

#### GET/POST `/api/public/verify-deletion?token=<token>`
Verify a deletion request using email verification token.

**Rate Limiting:** 5 requests per hour per IP address

### Admin Management

#### GET `/api/authenticated/admin/deletion-requests`
Get all deletion requests with filtering and pagination (admin only).

**Query Parameters:**
- `page` - Page number (default: 0)
- `limit` - Items per page (default: 20, max: 100)
- `status` - Filter by status
- `requestType` - Filter by request type
- `email` - Filter by email
- `action` - Special actions (e.g., 'cleanup-tokens')

#### POST `/api/authenticated/admin/deletion-requests`
Perform actions on deletion requests (admin only).

**Request Body:**
```json
{
  "action": "cancel|execute|get-audit-logs",
  "requestId": "ObjectId",
  "reason": "Optional reason for action"
}
```

`execute` runs a request that has not started (`pending`) and runs again one whose
last run stopped part-way (`processing`). A run that stops answers 500 with
`code: "DELETION_INCOMPLETE"`; the request stays `processing` and is run again
with the same call.

#### DELETE `/api/authenticated/admin/deletion-requests?action=bulk-cancel&requestIds=<id1,id2>`
Bulk operations on deletion requests (admin only).

#### POST `/api/authenticated/admin/delete-account`
An admin deletes an account that did not ask to be deleted (the Users page's
"Delete account"). It records a request of type `admin` and runs it at once,
through the same deletion as every other request. Nobody is notified.

**Request Body:**
```json
{
  "userId": "ObjectId",
  "email": "the account's email, as typed into the confirmation",
  "reason": "Optional, kept with the request"
}
```

Refused: a caller who is not an admin, a "View as" session (403 `VIEWING_AS`),
a missing or malformed user id (400 `INVALID_USER_ID`), an account that does
not exist (404 `USER_NOT_FOUND`), the admin's own account (403 `OWN_ACCOUNT`),
an admin's account (403 `TARGET_IS_ADMIN`), and an email that is not the
account's (400 `EMAIL_MISMATCH`). A deletion that began and stopped answers 500
`DELETION_INCOMPLETE` with the `requestId` to run again from the Deletion
Requests page.

## Features

### GDPR/CCPA Compliance

1. **30-Day Grace Period** - All deletion requests have a 30-day grace period before execution
2. **Right to Withdraw** - Users can cancel deletion requests at any time during the grace period
3. **Complete Data Removal** - All user data is removed from all collections
4. **Audit Trail** - Complete audit log of all deletion-related actions
5. **Notification Requirements** - Users are notified at key stages of the process

### Security Features

1. **Rate Limiting** - Prevents abuse of public endpoints
2. **Email Verification** - Public requests require email verification
3. **Admin Authentication** - Admin operations require proper authentication
4. **Audit Logging** - All actions are logged with timestamps and performer information
5. **Token Expiration** - Verification tokens expire after 24 hours

### How a Deletion Runs

The databases are standalone MongoDB servers, which refuse transactions, so a
deletion is a fixed sequence of steps (`DELETION_STEPS` in
`src/utils/accountDeletion.js`). Each step is safe to run again, a run does all
of them, and the request records how far it got.

A request's status: `pending_verification` (public requests, until the email
is verified), `pending`, `processing` (a deletion has started), `completed`,
`cancelled`. It becomes `completed` only after the last step. While it is
`processing` it holds `progress` (the steps the latest run finished),
`deletionResults` (what every run has removed so far, per collection) and,
after a run that stopped, `lastError` (`step`, `message`, `at`).

| Step | What it does | A stop here leaves |
|------|--------------|--------------------|
| `signOut` | Bans the account (better-auth then refuses it a session), deletes its sessions, the "View as" sessions it opened and its device codes, then drops its cached sessions | The account banned, signed out or not, all its data intact |
| `activity` | Watch history, the collection it was migrated from, presence, notifications, client error reports | Banned and signed out; some of these gone |
| `lists` | Its private lists and their titles, its titles in no list, its collaborator entries, its home-screen rows | As above, and some of its lists gone |
| `legacySignIn` | Its rows under the pre-better-auth names, where a database still has them | As above |
| `requests` | Closes its other deletion requests, removes their verification tokens | As above |
| `account` | Its OAuth links, then the user row, last of all | Its OAuth links gone; the user row may remain |

Every filter is built from the request's user id, which is checked before
anything is written: a request with a missing or malformed user id is refused.

### Data Deletion Scope

**Removed**

- Users database: `user`, `session` (its own, and the "View as" sessions it
  opened as other users), `account`, `deviceCode`, `PlaylistVisibility`,
  `DeletionVerificationTokens` (of its requests); and, where they still exist,
  the pre-better-auth `AuthenticatedUsers`, `SSOAccounts` (and their `_backup`
  copies), `authSessions`, `usedTokens`
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

### Notification System

The system integrates with the existing notification system to send:

1. **Deletion Request Confirmation** - Sent when request is created
2. **Email Verification** - Sent for public requests (logged to console)
3. **Deletion Reminders** - Sent 7 days before scheduled deletion
4. **Cancellation Confirmation** - Sent when request is cancelled
5. **Completion Notification** - Sent when deletion is completed
6. **Admin Notifications** - Sent to admins for new requests and failures

## Error Handling

The system includes comprehensive error handling for:

- Invalid email formats
- Non-existent user accounts
- Duplicate deletion requests
- Rate limit violations
- Database connection issues
- Authentication failures
- Invalid verification tokens

## Rate Limiting

Different rate limits are applied based on operation type:

- **Deletion Requests:** 3 per hour per IP
- **Status Checks:** 10 per hour per IP
- **Email Verification:** 5 per hour per IP
- **General API:** 100 per hour per IP
- **Admin Operations:** 50 per hour per IP

## Monitoring and Maintenance

### Scheduled Tasks

The system includes utilities for scheduled maintenance:

1. **Daily Cleanup** - Remove expired tokens, send reminders, process automatic deletions.
   Nothing schedules these today: `processAutomaticDeletions` and
   `scheduleReminderNotifications` are not called from anywhere, so a request
   whose grace period has ended is deleted when an admin executes it
2. **Hourly Maintenance** - Clean up rate limiter memory
3. **Health Checks** - Verify system components are working
4. **System Statistics** - Get current system status

### Audit Logging

All deletion-related actions are logged with:
- Action type
- Timestamp
- Performer (user or admin)
- IP address (where applicable)
- Additional details specific to the action

## Installation and Setup

1. The system automatically creates the required database collections on first use
2. No additional database setup is required
3. The system integrates with existing authentication and notification systems
4. Rate limiting is handled in-memory (consider Redis for production)

## Usage Examples

### For Authenticated Users

```javascript
// Request account deletion
const response = await fetch('/api/authenticated/account/delete-request', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ reason: 'No longer need the service' })
});

// Check deletion status
const status = await fetch('/api/authenticated/account/delete-request');

// Cancel deletion request
const cancel = await fetch('/api/authenticated/account/delete-request?requestId=123&reason=Changed my mind', {
  method: 'DELETE'
});
```

### For Public Users

```javascript
// Request account deletion
const response = await fetch('/api/public/delete-request', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ 
    email: 'user@example.com',
    reason: 'Privacy concerns'
  })
});

// Verify deletion request (from email link)
const verify = await fetch('/api/public/verify-deletion?token=abc123');
```

### For Admins

```javascript
// Get all deletion requests
const requests = await fetch('/api/authenticated/admin/deletion-requests?page=0&limit=20');

// Execute a deletion request
const execute = await fetch('/api/authenticated/admin/deletion-requests', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    action: 'execute',
    requestId: '123'
  })
});
```

## Security Considerations

1. **Email Verification** - Public requests require email verification to prevent abuse
2. **Rate Limiting** - Prevents brute force attacks and abuse
3. **Admin Authentication** - Only authenticated admins can manage deletion requests
4. **Audit Trail** - Complete logging for compliance and security monitoring
5. **Token Security** - Verification tokens are cryptographically secure and time-limited

## Compliance Notes

This implementation provides the technical foundation for GDPR/CCPA compliance but should be reviewed by legal counsel to ensure full compliance with applicable regulations. Key compliance features include:

- Right to erasure (right to be forgotten)
- Data portability (through existing export features)
- Consent withdrawal (cancellation capability)
- Audit trail for regulatory reporting
- Timely processing (30-day maximum)
- Complete data removal across all systems