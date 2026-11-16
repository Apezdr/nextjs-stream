// src/lib/authDisabledPaths.ts
// The better-auth endpoints this app turns off (auth.ts `disabledPaths`): a
// request to one is answered 404 before anything else runs. Paths are as
// better-auth names them, without the /api/auth prefix.
//
// - /admin/remove-user: the admin plugin's own "delete a user". It removes the
//   user, their sessions and their OAuth links, and nothing else: the watch
//   history, lists, notifications and deletion record would stay behind with
//   no account to find them by, and no audit entry is written. Accounts are
//   deleted through src/utils/accountDeletion.js only (the Users page's
//   "Delete account", and the Deletion Requests page).
//
// The check is on the HTTP route. Nothing in the app calls
// auth.api.removeUser(), which would not pass through it:
// __tests__/lib/authDisabledPaths.test.js fails if that changes.
export const DISABLED_AUTH_PATHS: readonly string[] = ['/admin/remove-user']
