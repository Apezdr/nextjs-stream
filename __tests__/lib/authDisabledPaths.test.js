/**
 * @jest-environment node
 *
 * better-auth's own "remove a user" endpoint is turned off
 * (src/lib/authDisabledPaths.ts). It deletes the user, their sessions and
 * their OAuth links and nothing else, so an account removed through it would
 * leave its watch history, lists, notifications and deletion record behind
 * with no account to find them by, and no audit entry. Accounts are deleted
 * through src/utils/accountDeletion.js only.
 *
 * better-auth is pinned to an exact version: the checks on its `dist` below
 * fail an upgrade that changes what the block relies on.
 */

const { readFileSync, readdirSync } = require('node:fs')
const { join, relative, sep } = require('node:path')

const { DISABLED_AUTH_PATHS } = require('@src/lib/authDisabledPaths')

const ROOT = join(__dirname, '..', '..')
const read = (...path) => readFileSync(join(ROOT, ...path), 'utf8')

const REMOVE_USER = '/admin/remove-user'

test('the admin plugin’s remove-user endpoint is on the list', () => {
  expect(DISABLED_AUTH_PATHS).toContain(REMOVE_USER)
})

test('auth.ts hands the list to better-auth', () => {
  const source = read('src', 'lib', 'auth.ts')
  expect(source).toMatch(/import \{ DISABLED_AUTH_PATHS \} from '\.\/authDisabledPaths'/)
  expect(source).toMatch(/\n {2}disabledPaths: \[\.\.\.DISABLED_AUTH_PATHS\],\n/)
})

describe('better-auth, as installed, still works the way the block relies on', () => {
  test('the endpoint is still served at that path, and still removes only the sign-in rows', () => {
    const routes = read('node_modules', 'better-auth', 'dist', 'plugins', 'admin', 'routes.mjs')
    expect(routes).toContain(`createAuthEndpoint("${REMOVE_USER}"`)
    // What it does, should the path ever be let through again
    expect(routes).toMatch(/internalAdapter\.deleteUserSessions\(ctx\.body\.userId\);\s+await ctx\.context\.internalAdapter\.deleteUser\(ctx\.body\.userId\);/)
  })

  test('a disabled path is answered 404 before anything else in the request runs', () => {
    const router = read('node_modules', 'better-auth', 'dist', 'api', 'index.mjs')
    // First thing in onRequest: before the rate limit, the plugins and the endpoint
    expect(router).toMatch(
      /async onRequest\(req\) \{\s+const disabledPaths = ctx\.options\.disabledPaths \|\| \[\];\s+const normalizedPath = normalizePathname\(req\.url, basePath\);\s+if \(disabledPaths\.includes\(normalizedPath\)\) return new Response\("Not Found", \{ status: 404 \}\);/
    )
  })

  test('the path compared has no base path and no trailing slash', () => {
    const url = read('node_modules', '@better-auth', 'core', 'dist', 'utils', 'url.mjs')
    expect(url).toContain('function normalizePathname(requestUrl, basePath)')
  })
})

describe('nothing else in the app deletes a user behind the deletion pipeline', () => {
  /** Every source file under src, as a path from the repo root. */
  function sources(dir = join(ROOT, 'src')) {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) return sources(full)
      return /\.(js|jsx|ts|tsx)$/.test(entry.name) ? [full] : []
    })
  }
  const pathOf = (file) => relative(ROOT, file).split(sep).join('/')

  test('no code calls better-auth’s removeUser, on the server or from a page', () => {
    // auth.api.removeUser() would not pass through the HTTP block
    const callers = sources()
      .filter((file) => pathOf(file) !== 'src/lib/authDisabledPaths.ts')
      .filter((file) => /\bremoveUser\s*\(|admin\/remove-user/.test(readFileSync(file, 'utf8')))
      .map(pathOf)
    expect(callers).toEqual([])
  })

  test('better-auth’s self-service delete-user stays off: auth.ts does not enable it', () => {
    // /delete-user answers only when user.deleteUser.enabled is set
    expect(read('src', 'lib', 'auth.ts')).not.toMatch(/deleteUser/)
    expect(read('node_modules', 'better-auth', 'dist', 'api', 'routes', 'update-user.mjs')).toMatch(
      /if \(!ctx\.context\.options\.user\?\.deleteUser\?\.enabled\) \{/
    )
  })

  test('the user row is deleted in one place: the deletion’s last step', () => {
    const deleters = sources()
      // Where deleteById is defined, and its own example of a call
      .filter((file) => pathOf(file) !== 'src/lib/userQueries.js')
      .filter((file) => /userQueries\.deleteById\(/.test(readFileSync(file, 'utf8')))
      .map(pathOf)
    expect(deleters).toEqual(['src/utils/accountDeletion.js'])
  })
})
