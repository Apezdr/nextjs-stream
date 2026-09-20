// Shared test setup: every page is signed in with the session that
// `npm run e2e:login` saved, and no test can write to the database.
const fs = require('fs')
const path = require('path')
const base = require('@playwright/test')

const TOKEN_FILE = path.join(__dirname, '.auth', 'token')

// The suite runs as a REAL account against the REAL database, so it must not
// be able to change anything: no watch progress, no watchlist edits, no
// dismissed notifications. Every request to the app that is not a GET is
// refused (Server Actions included: they are POSTs to the page's own address),
// except these, which are POSTs only because they carry a body and read
// nothing but data. A spec that needs another one adds it here deliberately.
const READ_ONLY_POSTS = ['/api/authenticated/media', '/api/authenticated/search']
// (This exists because a script that opened the player for five seconds
// rewrote the account's resume position for that episode.)

function readToken() {
  try {
    return fs.readFileSync(TOKEN_FILE, 'utf8').trim()
  } catch {
    return null
  }
}

const test = base.test.extend({
  // Playwright calls the second argument `use`. It is named `provide` here
  // because eslint's rules-of-hooks takes a call to `use(...)` for React's hook.
  context: async ({ context, baseURL }, provide, testInfo) => {
    const token = readToken()
    if (!token) {
      throw new Error('No saved session. Start the build (npm run e2e:start) and run: npm run e2e:login')
    }
    // The session travels as a bearer token, the way the TV app sends it. It is
    // attached to requests for the app's own origin ONLY: the pages also load
    // images and video from TMDB, YouTube and the file servers, and a
    // context-wide header would hand the session to every one of them.
    const origin = new URL(baseURL).origin
    const refused = new Set()
    await context.route(`${origin}/**`, async (route) => {
      const request = route.request()
      const method = request.method()
      const pathname = new URL(request.url()).pathname
      if (method !== 'GET' && method !== 'HEAD' && !READ_ONLY_POSTS.includes(pathname)) {
        refused.add(`${method} ${pathname}`)
        return route.abort()
      }
      await route.continue({
        headers: { ...request.headers(), authorization: `Bearer ${token}` },
      })
    })
    await provide(context)
    if (refused.size > 0) {
      testInfo.annotations.push({ type: 'writes refused', description: [...refused].join(', ') })
    }
  },
})

module.exports = { test, expect: base.expect }
