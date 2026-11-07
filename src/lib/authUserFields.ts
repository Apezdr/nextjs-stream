// src/lib/authUserFields.ts
// The extra fields better-auth keeps on each user and session. Kept out of
// auth.ts so they can be checked without starting better-auth and its database.
//
// `input` decides who may write a field. better-auth's POST
// /api/auth/update-user (and sign-up) accept every field whose `input` isn't
// false, straight from the request body. `approved` and `roles` are the
// admin's decisions, so only the server writes them: the create hook in
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
  // Role ids (src/lib/roles), given by admins from the Users page. Which
  // titles a user sees comes from the library scopes on these roles.
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

// The extra field on each session. better-auth's POST /api/auth/update-session
// accepts every session field whose `input` isn't false, so `input: false`
// keeps a client from setting it. No default: a session has none until the
// switch sets it, so every session starts without it, each new "View as"
// among them.
export const SESSION_ADDITIONAL_FIELDS = {
  // "View as" with writes on: the admin viewing as this session's user lets
  // its writes through (src/lib/viewAsGuard.ts). Only the bar's switch sets
  // it (src/lib/viewAsWrites.ts), and only on a view-as session, so it ends
  // with that session.
  viewAsWrites: {
    type: 'boolean',
    required: false,
    input: false,
  },
} satisfies Record<string, DBFieldAttribute>
