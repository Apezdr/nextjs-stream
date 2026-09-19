// Shared test setup: every page is signed in with the session that
// `npm run e2e:login` saved.
const fs = require('fs')
const path = require('path')
const base = require('@playwright/test')

const TOKEN_FILE = path.join(__dirname, '.auth', 'token')

function readToken() {
  try {
    return fs.readFileSync(TOKEN_FILE, 'utf8').trim()
  } catch {
    return null
  }
}

const test = base.test.extend({
  context: async ({ context, baseURL }, use) => {
    const token = readToken()
    if (!token) {
      throw new Error('No saved session. Start the build (npm run e2e:start) and run: npm run e2e:login')
    }
    // The session travels as a bearer token, the way the TV app sends it. It is
    // attached to requests for the app's own origin ONLY: the pages also load
    // images and video from TMDB, YouTube and the file servers, and a
    // context-wide header would hand the session to every one of them.
    const origin = new URL(baseURL).origin
    await context.route(`${origin}/**`, async (route) => {
      await route.continue({
        headers: { ...route.request().headers(), authorization: `Bearer ${token}` },
      })
    })
    await use(context)
  },
})

module.exports = { test, expect: base.expect }
