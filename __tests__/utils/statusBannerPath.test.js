/**
 * @jest-environment node
 *
 * The status banner renders in the shared (styled) layout on every signed-in
 * page load, and /api/authenticated/system-status is polled by every signed-in
 * tab. Settings reads do not belong on either path: PR #12 put two uncached
 * ones there, tripling the banner's Mongo work. These tests keep the settings
 * database module out of the path and the member-facing label neutral.
 */

const fs = require('fs')
const path = require('path')

jest.mock('@src/utils/config', () => ({
  getAllServers: () => [
    { id: 'default', displayName: 'Living Room NAS', syncEndpoint: 'http://default.test/node' },
    { id: 'server2', displayName: 'Offsite Library', syncEndpoint: 'http://server2.test/node' },
  ],
  getWebhookIdForServer: async () => null,
}))
jest.mock('@src/lib/httpHelper', () => ({
  httpGet: async () => ({ data: { status: 'normal' }, headers: {} }),
}))
jest.mock('@src/utils/admin_utils', () => ({
  getLatestSystemStatus: async () => ({}),
  getSystemStatusMessage: () => 'All systems normal',
}))

const { getProcessedSystemStatus } = require('@src/utils/getProcessedSystemStatus')

const ROOT = path.resolve(__dirname, '../..')
const EXTENSIONS = ['', '.js', '.jsx', '.ts', '.tsx', '/index.js', '/index.ts']
const IMPORT = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|^import\s*['"]([^'"]+)['"]/gm

function resolveImport(fromFile, specifier) {
  let base
  if (specifier.startsWith('@src/')) base = path.join(ROOT, 'src', specifier.slice(5))
  else if (specifier.startsWith('@components/')) base = path.join(ROOT, 'src/components', specifier.slice(12))
  else if (specifier.startsWith('.')) base = path.resolve(path.dirname(fromFile), specifier)
  else return null
  for (const extension of EXTENSIONS) {
    const candidate = base + extension
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate
  }
  return null
}

/** Every project file reachable from entry through static and dynamic imports. */
function reachableFiles(entry) {
  const seen = new Set()
  const pending = [path.join(ROOT, entry)]
  while (pending.length) {
    const file = pending.pop()
    if (seen.has(file)) continue
    seen.add(file)
    for (const match of fs.readFileSync(file, 'utf8').matchAll(IMPORT)) {
      const resolved = resolveImport(file, match[1] || match[2] || match[3])
      if (resolved) pending.push(resolved)
    }
  }
  return seen
}

const SETTINGS_DATABASE = path.join(ROOT, 'src/utils/admin_database.js')

test.each([
  'src/components/system/ServerStatusBanner.jsx',
  'src/utils/getProcessedSystemStatus.js',
  'src/app/api/authenticated/system-status/route.js',
])('%s does not reach the settings database', (entry) => {
  const files = reachableFiles(entry)

  expect(files.size).toBeGreaterThan(1)
  expect(files.has(SETTINGS_DATABASE)).toBe(false)
})

test("shows members the neutral server label, never the operator's display name", async () => {
  // The builder races each fetch against 2 s and 5 s timers; fake timers keep
  // those from outliving the test.
  jest.useFakeTimers()
  try {
    const { servers } = await getProcessedSystemStatus()

    expect(servers.map((server) => server.serverName)).toEqual(['Default', 'Server 2'])
  } finally {
    jest.useRealTimers()
  }
})
