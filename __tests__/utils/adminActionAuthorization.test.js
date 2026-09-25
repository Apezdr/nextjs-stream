/**
 * @jest-environment node
 *
 * Every exported 'use server' function is its own POST endpoint: the session
 * checks on the admin pages do not cover the actions those pages render.
 * These tests call each admin action the way a direct POST would, without an
 * admin session, and require a refusal before anything is written. Exports
 * are enumerated, so an action added to these modules without the check
 * fails here.
 */

const mockGetSession = jest.fn()
jest.mock('@src/lib/cachedAuth', () => ({ getSession: () => mockGetSession() }))
jest.mock('@src/lib/auth', () => ({ auth: {} }))
jest.mock('next/headers', () => ({ headers: jest.fn() }))
jest.mock('@src/utils/webhookServer', () => ({ validateWebhookId: jest.fn() }))

// Everything the actions can write to. None of it may be reached without an admin.
const mockUpdateById = jest.fn()
jest.mock('@src/lib/userQueries', () => ({
  userQueries: { updateById: (...args) => mockUpdateById(...args) },
}))

const mockCollection = { findOne: jest.fn(), deleteOne: jest.fn() }
const mockDb = jest.fn(() => ({ collection: () => mockCollection }))
jest.mock('@src/lib/mongodb', () => ({
  __esModule: true,
  default: Promise.resolve({ db: (...args) => mockDb(...args) }),
}))

const mockSettingsWrites = {
  setSyncAggressiveness: jest.fn(),
  setAutoSync: jest.fn(),
  setJitServeSettings: jest.fn(),
  setAutoCaptions: jest.fn(),
}
jest.mock('@src/utils/admin_database', () => ({
  SyncAggressivenessManager: jest.fn(() => ({
    setSyncAggressiveness: mockSettingsWrites.setSyncAggressiveness,
  })),
  AutoSyncManager: jest.fn(() => ({ setAutoSync: mockSettingsWrites.setAutoSync })),
  JitServeSettingsManager: jest.fn(() => ({
    setJitServeSettings: mockSettingsWrites.setJitServeSettings,
  })),
  AutoCaptionsManager: jest.fn(() => ({ setAutoCaptions: mockSettingsWrites.setAutoCaptions })),
}))

const mockRevalidatePath = jest.fn()
jest.mock('next/cache', () => ({ revalidatePath: (...args) => mockRevalidatePath(...args) }))
jest.mock('@src/utils/jit/serveSettings', () => ({ invalidateCachedJitServeSettings: jest.fn() }))
jest.mock('@src/utils/jit/health', () => ({ invalidateTranscoderHealthCache: jest.fn() }))
jest.mock('@src/utils/flatDatabaseUtils', () => ({ generateNormalizedVideoId: jest.fn() }))
jest.mock('@src/utils/cache/invalidation', () => ({
  invalidateMovieDetailsCache: jest.fn(),
  invalidateTVShowDetailsCache: jest.fn(),
  invalidateSeasonDetailsCache: jest.fn(),
  invalidateEpisodeDetailsCache: jest.fn(),
}))
jest.mock('mongodb', () => {
  class ObjectId {
    constructor(value) {
      this.value = String(value)
    }
    static isValid(value) {
      return /^[0-9a-f]{24}$/i.test(String(value))
    }
    toString() {
      return this.value
    }
  }
  return { ObjectId }
})

const settingsActions = require('@src/utils/actions/admin_settings')
const userActions = require('@src/utils/actions/admin_users')
const mediaActions = require('@src/utils/admin/flatMediaActions')

const VALID_ID = '0123456789abcdef01234567'

// Valid input for every settings action, so one missing its check would get
// as far as a write.
function settingsForm() {
  const form = new FormData()
  form.set('syncAggressiveness', 'Standard')
  form.set('automaticSyncEnabled', 'true')
  form.set('jitServeMode', 'prefer')
  form.set('jitServeMaxQueued', '')
  form.set('enabled', 'false')
  return form
}
const userChange = { userID: 'user-1', approved: true, limitedAccess: true }
const mediaPayload = {
  id: VALID_ID,
  showId: VALID_ID,
  episodeId: VALID_ID,
  seasonNumber: '1',
  episodeNumber: '1',
  title: 'Heat',
  originalTitle: 'Heat (1995)',
  videoURL: 'https://files.example/movies/Heat (1995)/Heat.mp4',
}

const exported = (mod) => Object.entries(mod).filter(([, value]) => typeof value === 'function')

// Settings and Users-page actions throw, as Next's docs recommend.
const throwingActions = [
  ...exported(settingsActions).map(([name, action]) => [name, () => action(settingsForm())]),
  ...exported(userActions).map(([name, action]) => [name, () => action(userChange)]),
]
// Editor actions run through useActionState, so they return the refusal.
const editorActions = exported(mediaActions).map(([name, action]) => [
  name,
  () => action(null, mediaPayload),
])

function expectNothingWritten() {
  expect(mockDb).not.toHaveBeenCalled()
  expect(mockUpdateById).not.toHaveBeenCalled()
  for (const write of Object.values(mockSettingsWrites)) expect(write).not.toHaveBeenCalled()
  expect(mockRevalidatePath).not.toHaveBeenCalled()
}

beforeEach(() => {
  jest.clearAllMocks()
})

test('finds every admin action it is meant to cover', () => {
  expect(throwingActions.map(([name]) => name).sort()).toEqual(
    expect.arrayContaining([
      'updateAutoCaptions',
      'updateAutomaticSync',
      'updateJitServeSettings',
      'updateSyncAggressiveness',
      'updateUserApprovedFlag',
      'updateUserLimitedAccessFlag',
    ])
  )
  expect(editorActions.length).toBeGreaterThanOrEqual(10)
})

describe.each([
  ['a signed-out caller', null],
  ['a signed-in member', { user: { id: 'member-1', role: 'user' } }],
])('%s', (_caller, session) => {
  beforeEach(() => {
    mockGetSession.mockResolvedValue(session)
  })

  test.each(throwingActions)('is refused by %s', async (_name, call) => {
    await expect(call()).rejects.toThrow('Admin access required.')
    expectNothingWritten()
  })

  test.each(editorActions)('is refused by %s', async (_name, call) => {
    await expect(call()).resolves.toEqual({ status: 'error', message: 'Admin access required.' })
    expectNothingWritten()
  })
})

describe('an admin', () => {
  beforeEach(() => {
    mockGetSession.mockResolvedValue({ user: { id: 'admin-1', role: 'admin' } })
  })

  test('can change a setting', async () => {
    await settingsActions.updateAutomaticSync(settingsForm())

    expect(mockSettingsWrites.setAutoSync).toHaveBeenCalledWith(true)
  })

  test('can approve a user', async () => {
    await userActions.updateUserApprovedFlag({ userID: 'user-1', approved: true })

    expect(mockUpdateById).toHaveBeenCalledWith('user-1', { approved: true })
  })

  test('can delete a movie from the editor', async () => {
    mockCollection.findOne.mockResolvedValue({ title: 'Heat', originalTitle: 'Heat (1995)' })
    mockCollection.deleteOne.mockResolvedValue({ deletedCount: 1 })

    await expect(mediaActions.deleteMovieAction(null, { id: VALID_ID })).resolves.toMatchObject({
      status: 'success',
      deleted: true,
    })
    expect(mockCollection.deleteOne).toHaveBeenCalledTimes(1)
  })
})
