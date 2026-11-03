/**
 * @jest-environment node
 *
 * The startup migration from the retired limitedAccess flag to the Preview
 * role (src/lib/roles/limitedAccessMigration.ts): every flagged user gets the
 * role, which carries an empty library scope; the flag goes from every user; a
 * second run changes nothing. It must not be able to get stuck: the role is
 * found again by its fixed id or marker, made under the first free name, and a
 * user's roles are repaired whatever was stored in them.
 */

const mockUsers = { countDocuments: jest.fn(), updateMany: jest.fn() }
const mockRoles = { findOne: jest.fn(), insertOne: jest.fn() }
jest.mock('@src/lib/userQueries', () => ({ userQueries: { collection: () => mockUsers } }))
jest.mock('@src/lib/mongodb', () => ({
  __esModule: true,
  default: Promise.resolve({ db: () => ({ collection: () => mockRoles }) }),
}))
jest.mock('@src/lib/logger', () => ({ createLogger: () => ({ info: jest.fn(), error: jest.fn() }) }))

const {
  PREVIEW_ROLE_ID,
  migrateLimitedAccess,
  migrateLimitedAccessOnce,
  rolesWithPreview,
} = require('@src/lib/roles/limitedAccessMigration')

const ROLE_ID = PREVIEW_ROLE_ID.toHexString()
const duplicate = () => Object.assign(new Error('E11000'), { code: 11000 })

/** The roles of the names already taken (case-insensitively, as the unique index has it). */
function rolesNamed(taken) {
  mockRoles.findOne.mockImplementation(async (filter) => {
    if (filter.$or) return null // no Preview role yet
    return taken.some((name) => name.toLowerCase() === filter.name.toLowerCase()) ? { _id: 'other' } : null
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockUsers.countDocuments.mockImplementation(async (filter) => (filter.limitedAccess === true ? 1 : 0))
  mockUsers.updateMany.mockResolvedValue({ modifiedCount: 0 })
  mockRoles.insertOne.mockResolvedValue({ insertedId: PREVIEW_ROLE_ID })
})

it('moves each flagged user onto a new Preview role with an empty scope, and clears every flag', async () => {
  rolesNamed([])
  mockUsers.updateMany.mockResolvedValueOnce({ modifiedCount: 3 }).mockResolvedValueOnce({ modifiedCount: 5 })

  expect(await migrateLimitedAccess()).toEqual({ moved: 3, cleared: 5, roleCreated: true })

  expect(mockRoles.findOne).toHaveBeenNthCalledWith(
    1,
    { $or: [{ _id: PREVIEW_ROLE_ID }, { migratedFrom: 'limitedAccess' }] },
    { projection: { _id: 1 } }
  )
  expect(mockRoles.insertOne).toHaveBeenCalledWith(
    expect.objectContaining({
      _id: PREVIEW_ROLE_ID,
      name: 'Preview',
      grants: {},
      scope: { movieRatingCap: null, tvRatingCap: null, titles: [] },
      migratedFrom: 'limitedAccess',
    })
  )
  // One write per user: the role added to what they hold (repaired), the flag removed
  expect(mockUsers.updateMany).toHaveBeenNthCalledWith(1, { limitedAccess: true }, [
    { $set: { roles: rolesWithPreview(ROLE_ID) } },
    { $unset: 'limitedAccess' },
  ])
  expect(mockUsers.updateMany).toHaveBeenNthCalledWith(2, { limitedAccess: { $exists: true } }, { $unset: { limitedAccess: '' } })
})

it('reuses the role it made before, found by its fixed id or marker, even renamed', async () => {
  mockRoles.findOne.mockResolvedValue({ _id: PREVIEW_ROLE_ID })
  expect((await migrateLimitedAccess()).roleCreated).toBe(false)
  expect(mockRoles.insertOne).not.toHaveBeenCalled()
  expect(mockUsers.updateMany.mock.calls[0][1][0]).toEqual({ $set: { roles: rolesWithPreview(ROLE_ID) } })
})

it('takes the first free name when admins already made roles called Preview', async () => {
  rolesNamed(['preview', 'Preview (limited access)', 'Preview (limited access) 2'])
  await migrateLimitedAccess()
  expect(mockRoles.insertOne).toHaveBeenCalledTimes(1)
  expect(mockRoles.insertOne.mock.calls[0][0].name).toBe('Preview (limited access) 3')
})

it('never gets stuck on names: past every name it tries, it takes one holding the role’s own id', async () => {
  mockRoles.findOne.mockImplementation(async (filter) => (filter.$or ? null : filter.name.includes(ROLE_ID) ? null : { _id: 'x' }))
  await migrateLimitedAccess()
  expect(mockRoles.insertOne.mock.calls[0][0].name).toBe(`Preview (limited access) ${ROLE_ID}`)
})

it('a name taken meanwhile moves on to the next; a role made meanwhile by another process is used', async () => {
  rolesNamed([])
  mockRoles.insertOne.mockRejectedValueOnce(duplicate()).mockResolvedValue({ insertedId: PREVIEW_ROLE_ID })
  await migrateLimitedAccess()
  expect(mockRoles.insertOne.mock.calls.map(([doc]) => doc.name)).toEqual(['Preview', 'Preview (limited access)'])

  jest.clearAllMocks()
  mockUsers.updateMany.mockResolvedValue({ modifiedCount: 1 })
  let made = false
  mockRoles.findOne.mockImplementation(async (filter) => (filter.$or ? (made ? { _id: PREVIEW_ROLE_ID } : null) : null))
  mockRoles.insertOne.mockImplementation(async () => {
    made = true
    throw duplicate()
  })
  expect((await migrateLimitedAccess()).roleCreated).toBe(false)
  expect(mockRoles.insertOne).toHaveBeenCalledTimes(1)
})

it('makes the role for a user handed its id directly (the better-auth migration script), with nobody flagged', async () => {
  rolesNamed([])
  mockUsers.countDocuments.mockImplementation(async (filter) => (filter.roles === ROLE_ID ? 1 : 0))
  expect(await migrateLimitedAccess()).toEqual({ moved: 0, cleared: 0, roleCreated: true })
  expect(mockUsers.updateMany).toHaveBeenCalledTimes(1) // only the leftover-flag cleanup
})

it('with nobody flagged and nobody holding the role, makes no role: a second run changes nothing', async () => {
  mockUsers.countDocuments.mockResolvedValue(0)
  expect(await migrateLimitedAccess()).toEqual({ moved: 0, cleared: 0, roleCreated: false })
  expect(mockRoles.findOne).not.toHaveBeenCalled()
  expect(mockUsers.updateMany).toHaveBeenCalledTimes(1)
})

// The roles expression, evaluated as Mongo would for each stored value
function evaluate(expression, doc, vars = {}) {
  if (typeof expression === 'string' && expression.startsWith('$$')) return vars[expression.slice(2)]
  if (typeof expression === 'string' && expression.startsWith('$')) return doc[expression.slice(1)]
  if (Array.isArray(expression)) return expression.map((item) => evaluate(item, doc, vars))
  if (!expression || typeof expression !== 'object') return expression
  const [[op, args]] = Object.entries(expression)
  const typeOf = (value) =>
    value === undefined ? 'missing' : value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value === 'string' ? 'string' : 'object'
  switch (op) {
    case '$setUnion':
      return [...new Set(args.flatMap((arg) => evaluate(arg, doc, vars)))]
    case '$filter': {
      const input = evaluate(args.input, doc, vars)
      return input.filter((item) => evaluate(args.cond, doc, { ...vars, this: item }))
    }
    case '$cond':
      return evaluate(args[0], doc, vars) ? evaluate(args[1], doc, vars) : evaluate(args[2], doc, vars)
    case '$isArray':
      return Array.isArray(evaluate(args, doc, vars))
    case '$eq':
      return evaluate(args[0], doc, vars) === evaluate(args[1], doc, vars)
    case '$type':
      return typeOf(evaluate(args, doc, vars))
    default:
      throw new Error(`unsupported ${op}`)
  }
}

it.each([
  ['missing', {}, [ROLE_ID]],
  ['null', { roles: null }, [ROLE_ID]],
  ['a lone id as a string', { roles: 'r1' }, ['r1', ROLE_ID]],
  ['an object', { roles: { r1: true } }, [ROLE_ID]],
  ['an array with junk in it', { roles: ['r1', null, 7, { x: 1 }] }, ['r1', ROLE_ID]],
  ['an array already holding it', { roles: [ROLE_ID, 'r2'] }, [ROLE_ID, 'r2']],
])('repairs roles stored as %s, then adds the Preview role', (_case, doc, expected) => {
  expect(evaluate(rolesWithPreview(ROLE_ID), doc)).toEqual(expected)
})

it('runs once per process and retries until it succeeds', async () => {
  const retries = []
  const run = jest.fn().mockRejectedValueOnce(new Error('mongo starting')).mockResolvedValue({})
  migrateLimitedAccessOnce(run, (retry) => retries.push(retry))
  migrateLimitedAccessOnce(run, (retry) => retries.push(retry))
  await new Promise((resolve) => setImmediate(resolve))
  expect(run).toHaveBeenCalledTimes(1)
  retries.shift()()
  await new Promise((resolve) => setImmediate(resolve))
  expect(run).toHaveBeenCalledTimes(2)
  expect(retries).toHaveLength(0)
})
