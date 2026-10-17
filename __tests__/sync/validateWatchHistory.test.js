/**
 * @jest-environment node
 *
 * When the watch-history validation runs (sync/run/validateWatchHistory): at
 * once when media is removed, never two at a time, and on a skipped tick only
 * every 15 minutes.
 */

jest.mock('@src/lib/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}))
jest.mock('@src/utils/sync/run/watchHistoryValidation', () => ({
  validateWatchHistoryAgainstDatabase: jest.fn(),
}))

const { validateWatchHistoryAgainstDatabase } = require('@src/utils/sync/run/watchHistoryValidation')
const {
  validateWatchHistory,
  validateWatchHistoryIfDue,
  REVALIDATE_INTERVAL_MS,
} = require('@src/utils/sync/run/validateWatchHistory')

/** Validations that finish only when the test says so, in the order they started. */
function heldValidations() {
  const started = []
  validateWatchHistoryAgainstDatabase.mockImplementation(
    () =>
      new Promise((resolve) => {
        started.push((value = { run: started.length }) => resolve(value))
      })
  )
  return started
}

const flush = async () => {
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve))
}

beforeEach(() => {
  delete globalThis.__watchHistoryValidationState
  validateWatchHistoryAgainstDatabase.mockReset()
})

describe('validateWatchHistory', () => {
  it('runs the validation and hands back its results', async () => {
    validateWatchHistoryAgainstDatabase.mockResolvedValue({ markedInvalid: 2 })

    await expect(validateWatchHistory('admin delete')).resolves.toEqual({ markedInvalid: 2 })
    expect(validateWatchHistoryAgainstDatabase).toHaveBeenCalledTimes(1)
  })

  it('runs once more after a run in progress, which may have read the catalog before the change', async () => {
    const started = heldValidations()

    const first = validateWatchHistory('restore timer')
    const second = validateWatchHistory('admin delete')
    await flush()
    // Never two at a time
    expect(started).toHaveLength(1)

    started[0]({ run: 'first' })
    await expect(first).resolves.toEqual({ run: 'first' })
    await flush()
    expect(started).toHaveLength(2)
    started[1]({ run: 'second' })
    await expect(second).resolves.toEqual({ run: 'second' })
  })

  it('gives every request made during one run the same single follow-up', async () => {
    const started = heldValidations()

    validateWatchHistory('full pass')
    const a = validateWatchHistory('admin delete')
    const b = validateWatchHistory('admin delete')
    started[0]()
    await flush()
    started[1]({ run: 'follow-up' })

    await expect(a).resolves.toEqual({ run: 'follow-up' })
    await expect(b).resolves.toEqual({ run: 'follow-up' })
    await flush()
    expect(started).toHaveLength(2)
  })

  it('never throws: a failed validation comes back as an error, and the next one runs', async () => {
    validateWatchHistoryAgainstDatabase.mockRejectedValueOnce(new Error('mongo down'))
    validateWatchHistoryAgainstDatabase.mockResolvedValueOnce({ markedInvalid: 0 })

    await expect(validateWatchHistory('full pass')).resolves.toEqual({ error: 'mongo down' })
    await expect(validateWatchHistory('full pass')).resolves.toEqual({ markedInvalid: 0 })
  })
})

describe('validateWatchHistoryIfDue (a skipped tick)', () => {
  it('validates when none has run in this process', async () => {
    validateWatchHistoryAgainstDatabase.mockResolvedValue({ markedValid: 1 })

    await expect(validateWatchHistoryIfDue()).resolves.toEqual({ markedValid: 1 })
  })

  it('does not validate until 15 minutes after the last validation finished, whatever ran it', async () => {
    validateWatchHistoryAgainstDatabase.mockResolvedValue({ markedValid: 0 })
    const now = Date.now()
    jest.spyOn(Date, 'now').mockReturnValue(now)
    try {
      await validateWatchHistory('full pass')

      await expect(validateWatchHistoryIfDue(now + REVALIDATE_INTERVAL_MS - 1)).resolves.toBeNull()
      expect(validateWatchHistoryAgainstDatabase).toHaveBeenCalledTimes(1)

      await expect(validateWatchHistoryIfDue(now + REVALIDATE_INTERVAL_MS)).resolves.toEqual({ markedValid: 0 })
      expect(validateWatchHistoryAgainstDatabase).toHaveBeenCalledTimes(2)
    } finally {
      Date.now.mockRestore()
    }
  })

  it('does not start one while one is running', async () => {
    const started = heldValidations()
    validateWatchHistory('full pass')

    await expect(validateWatchHistoryIfDue(Date.now() + 2 * REVALIDATE_INTERVAL_MS)).resolves.toBeNull()
    started[0]()
    await flush()
    expect(started).toHaveLength(1)
  })
})
