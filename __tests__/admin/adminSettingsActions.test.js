jest.mock('@src/utils/routeAuth', () => ({ requireAdminAction: jest.fn() }))
jest.mock('@src/utils/config', () => ({ getAllServers: jest.fn() }))
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }))
jest.mock('@src/utils/appTimeZone.server', () => ({ clearAppTimeZoneCache: jest.fn() }))

jest.mock('@src/utils/admin_database', () => ({
  AutoSyncManager: jest.fn(() => ({ setAutoSync: jest.fn() })),
  SyncAggressivenessManager: jest.fn(() => ({ setSyncAggressiveness: jest.fn() })),
  AutoCaptionsManager: jest.fn(() => ({ setAutoCaptions: jest.fn() })),
  JitServeSettingsManager: jest.fn(() => ({ setJitServeSettings: jest.fn() })),
  ServerDisplayNameManager: jest.fn(() => ({ setServerDisplayName: jest.fn() })),
  SyncServerLatencySettingsManager: jest.fn(() => ({ setEnabled: jest.fn() })),
  AppTimeZoneManager: jest.fn(() => ({ setTimeZone: jest.fn() })),
  SystemPerformanceAlertSettingsManager: jest.fn(() => ({ setEnabled: jest.fn() })),
  LocalAccessSettingsManager: jest.fn(() => ({ setEnabled: jest.fn() })),
}))

import {
  updateAutomaticSync,
  updateAutoCaptions,
  updateJitServeSettings,
  updateSyncAggressiveness,
  updateServerDisplayName,
  updateSyncServerLatency,
  updateAppTimeZone,
  updateSystemPerformanceAlerts,
  updateLocalAccess,
} from '@src/utils/actions/admin_settings'
import { requireAdminAction } from '@src/utils/routeAuth'
import { getAllServers } from '@src/utils/config'
import {
  AutoSyncManager,
  SyncAggressivenessManager,
  AutoCaptionsManager,
  JitServeSettingsManager,
  ServerDisplayNameManager,
  SyncServerLatencySettingsManager,
  AppTimeZoneManager,
  SystemPerformanceAlertSettingsManager,
  LocalAccessSettingsManager,
} from '@src/utils/admin_database'

const managers = [
  AutoSyncManager.mock.results[0].value,
  SyncAggressivenessManager.mock.results[0].value,
  AutoCaptionsManager.mock.results[0].value,
  JitServeSettingsManager.mock.results[0].value,
  ServerDisplayNameManager.mock.results[0].value,
  SyncServerLatencySettingsManager.mock.results[0].value,
  AppTimeZoneManager.mock.results[0].value,
  SystemPerformanceAlertSettingsManager.mock.results[0].value,
  LocalAccessSettingsManager.mock.results[0].value,
]

beforeEach(() => {
  requireAdminAction.mockReset().mockResolvedValue({ id: 'admin-id', role: 'admin' })
  getAllServers.mockReset().mockReturnValue([])
  for (const manager of managers) {
    for (const method of Object.values(manager)) method.mockReset().mockResolvedValue(undefined)
  }
})

describe('admin settings authorization', () => {
  it.each([
    ['sync aggressiveness', updateSyncAggressiveness],
    ['automatic sync', updateAutomaticSync],
    ['JIT serving', updateJitServeSettings],
    ['automatic captions', updateAutoCaptions],
    ['server display names', updateServerDisplayName],
    ['sync server latency', updateSyncServerLatency],
    ['application time zone', updateAppTimeZone],
    ['system performance alerts', updateSystemPerformanceAlerts],
  ])('blocks %s mutations before accessing settings storage', async (_label, action) => {
    requireAdminAction.mockRejectedValue(new Error('Admin access required.'))

    await expect(action(new FormData())).rejects.toThrow('Admin access required.')

    for (const manager of managers) {
      for (const method of Object.values(manager)) expect(method).not.toHaveBeenCalled()
    }
  })
})

describe('server display name settings', () => {
  test('rejects writes when Docker Compose owns the name', async () => {
    getAllServers.mockReturnValue([{
      id: 'default',
      environmentDisplayName: 'Compose Primary',
      displayNameEnvironmentVariable: 'SERVER_DISPLAY_NAME',
    }])
    const formData = new FormData()
    formData.set('serverId', 'default')
    formData.set('displayName', 'Hidden database value')

    await expect(updateServerDisplayName(null, formData)).resolves.toEqual({
      status: 'error',
      message: 'This name is managed by SERVER_DISPLAY_NAME.',
    })
    expect(ServerDisplayNameManager.mock.results[0].value.setServerDisplayName).not.toHaveBeenCalled()
  })
})

describe('sync server latency settings', () => {
  test('persists the explicit disabled state', async () => {
    const formData = new FormData()
    formData.set('syncServerLatencyEnabled', 'false')

    await expect(updateSyncServerLatency(null, formData)).resolves.toEqual({
      status: 'success',
      enabled: false,
    })
    expect(SyncServerLatencySettingsManager.mock.results[0].value.setEnabled)
      .toHaveBeenCalledWith(false)
  })
})

describe('application time zone settings', () => {
  test('normalizes and persists a valid IANA zone', async () => {
    const formData = new FormData()
    formData.set('timeZone', ' America/Chicago ')

    await expect(updateAppTimeZone(null, formData)).resolves.toMatchObject({
      status: 'success',
      timeZone: 'America/Chicago',
    })
    expect(AppTimeZoneManager.mock.results[0].value.setTimeZone)
      .toHaveBeenCalledWith('America/Chicago')
  })

  test('rejects invalid zones without writing', async () => {
    const formData = new FormData()
    formData.set('timeZone', 'Not/AZone')

    await expect(updateAppTimeZone(null, formData)).resolves.toMatchObject({ status: 'error' })
    expect(AppTimeZoneManager.mock.results[0].value.setTimeZone).not.toHaveBeenCalled()
  })
})

describe('updateLocalAccess', () => {
  const setEnabled = () => LocalAccessSettingsManager.mock.results[0].value.setEnabled

  test('persists the enabled and disabled states', async () => {
    const on = new FormData()
    on.set('localAccessEnabled', 'true')
    await expect(updateLocalAccess(null, on)).resolves.toEqual({ status: 'success', enabled: true })
    expect(setEnabled()).toHaveBeenCalledWith(true)

    const off = new FormData()
    off.set('localAccessEnabled', 'false')
    await expect(updateLocalAccess(null, off)).resolves.toEqual({ status: 'success', enabled: false })
    expect(setEnabled()).toHaveBeenCalledWith(false)
  })

  test('anything other than the literal "true" turns it off', async () => {
    for (const value of ['TRUE', '1', 'yes', '']) {
      const formData = new FormData()
      formData.set('localAccessEnabled', value)
      await expect(updateLocalAccess(null, formData)).resolves.toEqual({ status: 'success', enabled: false })
    }
  })

  test('a non-admin cannot enable it, and nothing is written', async () => {
    requireAdminAction.mockRejectedValueOnce(new Error('Unauthorized'))
    const formData = new FormData()
    formData.set('localAccessEnabled', 'true')
    await expect(updateLocalAccess(null, formData)).rejects.toThrow('Unauthorized')
    expect(setEnabled()).not.toHaveBeenCalled()
  })
})

test('persists disabled system performance alerts', async () => {
  const formData = new FormData()
  formData.set('systemPerformanceAlertsEnabled', 'false')
  await expect(updateSystemPerformanceAlerts(null, formData)).resolves.toEqual({ status: 'success', enabled: false })
  expect(SystemPerformanceAlertSettingsManager.mock.results[0].value.setEnabled).toHaveBeenCalledWith(false)
})