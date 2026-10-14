// src/lib/authUserFields.ts
// The extra fields better-auth keeps on each user. Kept out of auth.ts so
// they can be checked without starting better-auth and its database.
//
// `input` decides who may write a field. better-auth's POST
// /api/auth/update-user (and sign-up) accept every field whose `input` isn't
// false, straight from the request body. `approved` and `limitedAccess` are
// the admin's decisions, so only the server writes them: the create hook in
// auth.ts and the admin actions (src/utils/actions/admin_users.js), which go
// to the database directly. With `input: true`, any signed-in user could
// approve themselves.
import type { DBFieldAttribute } from 'better-auth/db'

export const USER_ADDITIONAL_FIELDS = {
  approved: {
    type: 'boolean',
    required: false,
    defaultValue: false,
    input: false,
  },
  limitedAccess: {
    type: 'boolean',
    required: false,
    defaultValue: false,
    input: false,
  },
  // Role ids (src/lib/roles), given by admins from the Users page.
  roles: {
    type: 'string[]',
    required: false,
    input: false,
  },
  // Stored as object in MongoDB (better-auth 'string' type allows flexible storage)
  // Migration keeps it as object - no JSON.parse/stringify needed in app code
  preferences: {
    type: 'string',
    required: false,
    input: true,
  },
} satisfies Record<string, DBFieldAttribute>
