/**
 * `@src/lib/mongodb` default-exports a Promise<MongoClient>, not a client.
 * Treating it as a client threw `.db is not a function` inside session
 * resolution, which 500'd every authenticated page rather than just declining
 * the bypass. These tests pin both halves of that: the promise must be awaited,
 * and any failure in this optional path must deny instead of propagating.
 */

const findOne = jest.fn()
const collection = jest.fn(() => ({ findOne }))
const db = jest.fn(() => ({ collection }))

jest.mock('@src/lib/mongodb', () => ({
  __esModule: true,
  default: Promise.resolve({ db }),
}))

const getEnabled = jest.fn()
jest.mock('@src/utils/admin_database', () => ({
  LocalAccessSettingsManager: jest.fn(() => ({ getEnabled })),
}))

jest.mock('@src/lib/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}))

const SECRET = 'a'.repeat(64)

function headersFor(secret = SECRET, ip = '192.168.0.50') {
  return new Headers({ 'x-local-access-assertion': secret, 'x-real-ip': ip })
}

describe('localOwnerSession', () => {
  let resolveServerOwner
  let getLocalOwnerSession

  beforeEach(async () => {
    jest.clearAllMocks()
    process.env.LOCAL_ACCESS_ASSERTION_SECRET = SECRET
    process.env.LOCAL_ACCESS_ALLOWED_NETWORKS = '192.168.0.0/16'
    process.env.MONGODB_AUTH_DB = 'Users'
    getEnabled.mockResolvedValue(true)
    findOne.mockResolvedValue({ _id: 'owner-1', email: 'owner@example.com', role: 'admin' })
    const mod = await import('@src/lib/localOwnerSession')
    resolveServerOwner = mod.resolveServerOwner
    getLocalOwnerSession = mod.getLocalOwnerSession
  })

  it('awaits the client promise before calling db()', async () => {
    await expect(resolveServerOwner()).resolves.toMatchObject({ _id: 'owner-1' })
    expect(db).toHaveBeenCalledWith('Users')
  })

  it('grants the owner session for a qualifying request', async () => {
    const result = await getLocalOwnerSession(headersFor())
    expect(result.user.id).toBe('owner-1')
    expect(result.session.authSource).toBe('local-access')
    expect(result.session.token).toBeUndefined()
  })

  it('denies instead of throwing when the owner lookup fails', async () => {
    findOne.mockRejectedValue(new Error('mongo down'))
    await expect(getLocalOwnerSession(headersFor())).resolves.toBeNull()
  })

  it('denies a request from outside the allowed networks', async () => {
    await expect(getLocalOwnerSession(headersFor(SECRET, '203.0.113.9'))).resolves.toBeNull()
  })
})
