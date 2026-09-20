// Signs the e2e suite in the same way the TV app signs in: the device flow.
//
// Sign-in is OAuth-only, so a test can't log in by itself. This asks the running
// server for a device code, prints the address to approve it at, and waits.
// Approve it in a browser where you are already signed in. The OAuth providers
// only accept the local domain, not localhost, which is why the rig serves the
// build on the dev server's port behind that domain. The resulting session token is written to e2e/.auth/token, which is gitignored.
//
//   npm run e2e:start      (in another terminal, after npm run e2e:build; stop the dev server first)
//   npm run e2e:login
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const BASE_URL = process.env.BASE_URL || 'https://cinema-local.adamdrumm.com'
const CLIENT_ID = 'e2e-instant-navigation'
const TOKEN_FILE = resolve(dirname(fileURLToPath(import.meta.url)), '.auth/token')

async function post(path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  return { status: res.status, json }
}

const start = await post('/api/auth/device/code', { client_id: CLIENT_ID })
if (start.status !== 200 || !start.json.device_code) {
  console.error(`Could not start the device flow (HTTP ${start.status}). Is the server at ${BASE_URL} up, with its database?`)
  process.exit(1)
}

const { device_code, user_code, expires_in, interval } = start.json
console.log(`\nApprove this sign-in while signed in:\n\n  ${BASE_URL}/device?user_code=${user_code}\n\nCode: ${user_code}  (valid for ${Math.round(expires_in / 60)} minutes)\n`)

let waitMs = Math.max(5, interval || 5) * 1000
const deadline = Date.now() + expires_in * 1000
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, waitMs))
  const poll = await post('/api/auth/device/token', {
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    device_code,
    client_id: CLIENT_ID,
  })
  if (poll.json.access_token) {
    mkdirSync(dirname(TOKEN_FILE), { recursive: true })
    writeFileSync(TOKEN_FILE, poll.json.access_token, { mode: 0o600 })
    console.log('Signed in. Session saved for the e2e suite.')
    process.exit(0)
  }
  const error = poll.json.error
  if (error === 'slow_down') waitMs += 5000
  else if (error && error !== 'authorization_pending') {
    console.error(`Sign-in was not completed: ${error}`)
    process.exit(1)
  }
}
console.error('The code expired before it was approved.')
process.exit(1)
