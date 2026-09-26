/**
 * @jest-environment node
 *
 * Server display names come only from SERVER_DISPLAY_NAME[_N], read once when
 * the config module loads: no database read and no per-request work. Admin
 * pages show them; member-facing surfaces keep the neutral id-derived label.
 */

import {
  normalizeServerDisplayName,
  SERVER_DISPLAY_NAME_MAX_LENGTH,
} from '@src/utils/serverLabel'

const ORIGINAL_ENV = process.env
const SERVER_ENV = /^(SERVER_DISPLAY_NAME|NODE_SERVER_URL|FILE_SERVER_URL|NODE_SERVER_INTERNAL_URL|FILE_SERVER_PREFIX_PATH)/

function loadServers(env) {
  const base = Object.fromEntries(
    Object.entries(ORIGINAL_ENV).filter(([key]) => !SERVER_ENV.test(key))
  )
  process.env = {
    ...base,
    FILE_SERVER_URL: 'https://files.example.test',
    NODE_SERVER_URL: 'https://files.example.test/node',
    ...env,
  }
  let servers
  jest.isolateModules(() => {
    servers = require('@src/utils/config').getAllServers()
  })
  return servers.map(({ id, displayName }) => ({ id, displayName }))
}

beforeEach(() => {
  jest.spyOn(console, 'debug').mockImplementation(() => {})
})

afterEach(() => {
  console.debug.mockRestore()
  process.env = ORIGINAL_ENV
})

describe('server display names from the environment', () => {
  test('names each configured server from its own variable', () => {
    expect(
      loadServers({
        NODE_SERVER_URL_2: 'https://offsite.example.test/node',
        FILE_SERVER_URL_2: 'https://offsite.example.test',
        SERVER_DISPLAY_NAME: 'Living Room NAS',
        SERVER_DISPLAY_NAME_1: 'Ignored: there is no server1',
        SERVER_DISPLAY_NAME_2: 'Offsite Library',
        SERVER_DISPLAY_NAME_3: 'Ignored: server 3 is not configured',
      })
    ).toEqual([
      { id: 'default', displayName: 'Living Room NAS' },
      { id: 'server2', displayName: 'Offsite Library' },
    ])
  })

  test('falls back to the id-derived label when no name is set', () => {
    expect(
      loadServers({
        NODE_SERVER_URL_2: 'https://offsite.example.test/node',
        FILE_SERVER_URL_2: 'https://offsite.example.test',
      })
    ).toEqual([
      { id: 'default', displayName: 'Default' },
      { id: 'server2', displayName: 'Server 2' },
    ])
  })

  test('treats a blank name as unset', () => {
    expect(loadServers({ SERVER_DISPLAY_NAME: ' \t ' })).toEqual([
      { id: 'default', displayName: 'Default' },
    ])
  })
})

describe('normalizeServerDisplayName', () => {
  test('replaces control and bidi-override characters and collapses whitespace', () => {
    expect(normalizeServerDisplayName('  Living\u0007Room‮   NAS\n')).toBe('Living Room NAS')
  })

  test(`caps names at ${SERVER_DISPLAY_NAME_MAX_LENGTH} characters`, () => {
    expect(normalizeServerDisplayName('x'.repeat(100))).toHaveLength(SERVER_DISPLAY_NAME_MAX_LENGTH)
  })

  test('returns an empty string for anything that is not a string', () => {
    expect(normalizeServerDisplayName(undefined)).toBe('')
    expect(normalizeServerDisplayName(42)).toBe('')
  })
})
