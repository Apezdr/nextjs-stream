jest.mock('next/cache', () => ({
  revalidatePath: jest.fn(),
}))

jest.mock('@src/utils/admin_database', () => {
  const setJitServeSettings = jest.fn()
  return {
    AutoSyncManager: jest.fn().mockImplementation(() => ({})),
    SyncAggressivenessManager: jest.fn().mockImplementation(() => ({})),
    AutoCaptionsManager: jest.fn().mockImplementation(() => ({})),
    JitServeSettingsManager: jest.fn().mockImplementation(() => ({ setJitServeSettings })),
    __mockSetJitServeSettings: setJitServeSettings,
  }
})

jest.mock('@src/utils/jit/serveSettings', () => ({
  invalidateCachedJitServeSettings: jest.fn(),
}))

jest.mock('@src/utils/jit/health', () => ({
  invalidateTranscoderHealthCache: jest.fn(),
}))

import { revalidatePath } from 'next/cache'
import { __mockSetJitServeSettings as mockSetJitServeSettings } from '@src/utils/admin_database'
import { invalidateCachedJitServeSettings } from '@src/utils/jit/serveSettings'
import { invalidateTranscoderHealthCache } from '@src/utils/jit/health'
import { updateJitServeSettings } from '@src/utils/actions/admin_settings'

function settingsForm(mode, maxQueued = '') {
  const formData = new FormData()
  formData.set('jitServeMode', mode)
  formData.set('jitServeMaxQueued', maxQueued)
  return formData
}

describe('updateJitServeSettings', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('clears delivery caches and invalidates every player route after the write', async () => {
    await updateJitServeSettings(settingsForm('prefer'))

    expect(mockSetJitServeSettings).toHaveBeenCalledWith({ mode: 'prefer', maxQueued: null })
    expect(invalidateCachedJitServeSettings).toHaveBeenCalledTimes(1)
    expect(invalidateTranscoderHealthCache).toHaveBeenCalledTimes(1)
    expect(revalidatePath.mock.calls).toEqual([
      ['/list/movie/[title]/play', 'page'],
      ['/list/tv/[title]/[season]/[episode]/play', 'page'],
      ['/list/[...media]', 'page'],
    ])

    const writeOrder = mockSetJitServeSettings.mock.invocationCallOrder[0]
    expect(invalidateCachedJitServeSettings.mock.invocationCallOrder[0]).toBeGreaterThan(
      writeOrder
    )
    expect(revalidatePath.mock.invocationCallOrder[0]).toBeGreaterThan(writeOrder)
  })

  test('does not invalidate anything when validation rejects the mutation', async () => {
    await expect(updateJitServeSettings(settingsForm('invalid'))).rejects.toThrow(
      'Invalid JIT serve mode'
    )

    expect(mockSetJitServeSettings).not.toHaveBeenCalled()
    expect(invalidateCachedJitServeSettings).not.toHaveBeenCalled()
    expect(invalidateTranscoderHealthCache).not.toHaveBeenCalled()
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})
