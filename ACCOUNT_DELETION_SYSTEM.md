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

#### DELETE `/api/authenticated/admin/deletion-requests?action=bulk-cancel&requestIds=<id1,id2>`
Bulk operations on deletion requests (admin only).

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

### Data Deletion Scope

The system deletes data from the following collections:

**Users Database:**
- `AuthenticatedUsers` - User account data
- `SSOAccounts` - Social sign-on accounts
- `session` - User sessions
- `authSessions` - Authentication sessions
- `usedTokens` - Used authentication tokens

**Media Database:**
- `PlaybackStatus` - User viewing history and progress
- `Notifications` - User notifications
- `UserPreferences` - User preferences and settings

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

1. **Daily Cleanup** - Remove expired tokens, send reminders, process automatic deletions
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