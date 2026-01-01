# User Approval System

This application includes a user approval system that controls whether new users can immediately access content or need manual admin approval.

## Configuration

### Environment Variable

Add the following environment variable to your `.env` file:

```bash
# User Approval Settings
# Set to 'true' to automatically approve new users, 'false' to require manual admin approval (default)
AUTO_APPROVE_USERS=false
```

### Options

- `AUTO_APPROVE_USERS=true`: New users are automatically approved and can access content immediately after signing in
- `AUTO_APPROVE_USERS=false` (default): New users require manual approval by an admin before they can access content

## How It Works

### Automatic Approval (AUTO_APPROVE_USERS=true)

1. User signs in with Google/Discord OAuth
2. User account is created with `approved: true`
3. User can immediately access all content (subject to `limitedAccess` restrictions)

### Manual Approval (AUTO_APPROVE_USERS=false)

1. User signs in with Google/Discord OAuth
2. User account is created with `approved: false`
3. User is redirected to an approval pending page
4. Admin must manually approve the user through the admin panel
5. Once approved, user can access content

## Admin Management

Admins can manage user approvals through the admin panel:

- **View Users**: See all users and their approval status
- **Approve Users**: Manually approve pending users
- **Reject Users**: Revoke approval from users
- **Limited Access**: Set users to have limited access to content

## Technical Implementation

### Files Modified

- **`.env.example`**: Added `AUTO_APPROVE_USERS` configuration option
- **`src/lib/MongoDBCustomAdapter.js`**: Modified user creation to respect auto-approval setting
- **`src/utils/autoApproval.js`**: Utility functions for checking approval settings

### Key Components

- **`src/components/HOC/ApprovedUser.js`**: Higher-order component that redirects unapproved users
- **`src/components/Admin/ListRecords.js`**: Admin interface for managing user approvals
- **`src/lib/auth.ts`**: Authentication configuration and session management

## Security Considerations

- Admin users (defined in `ADMIN_USER_EMAILS`) are always automatically approved regardless of the `AUTO_APPROVE_USERS` setting
- The approval system works in conjunction with the `limitedAccess` flag for additional content restrictions
- Users without approval cannot access any authenticated content

## Migration

If you're enabling auto-approval on an existing installation:

1. Set `AUTO_APPROVE_USERS=true` in your environment
2. Existing unapproved users will still need manual approval
3. Only new users created after the setting change will be auto-approved

To approve all existing users programmatically, you can run a database update:

```javascript
// MongoDB query to approve all existing users
db.AuthenticatedUsers.updateMany(
  { approved: false },
  { $set: { approved: true } }
)