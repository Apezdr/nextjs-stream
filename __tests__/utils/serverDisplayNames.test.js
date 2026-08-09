jest.mock('@src/utils/config', () => ({ getAllServers: jest.fn() }))
jest.mock('@src/utils/admin_database', () => ({
  ServerDisplayNameManager: jest.fn(() => ({ getServerDisplayNames: jest.fn() })),
}))

import { applyServerDisplayNames } from '@src/utils/serverDisplayNames'

describe('applyServerDisplayNames', () => {
  test('uses environment, database, then derived labels without changing server IDs', () => {
    const servers = [
      { id: 'default', environmentDisplayName: ' Compose Primary ' },
      { id: 'server2' },
      { id: 'server3' },
    ]

    const result = applyServerDisplayNames(servers, {
      default: 'Database Primary',
      server2: 'Remote Library',
    })

    expect(result).toEqual([
      expect.objectContaining({
        id: 'default',
        displayName: 'Compose Primary',
        displayNameOverride: 'Database Primary',
        displayNameSource: 'environment',
        displayNameEditable: false,
      }),
      expect.objectContaining({
        id: 'server2',
        displayName: 'Remote Library',
        displayNameOverride: 'Remote Library',
        displayNameSource: 'database',
        displayNameEditable: true,
      }),
      expect.objectContaining({
        id: 'server3',
        displayName: 'Server 3',
        displayNameOverride: '',
        displayNameSource: 'derived',
        displayNameEditable: true,
      }),
    ])
    expect(result.map((server) => server.id)).toEqual(servers.map((server) => server.id))
  })

  test('normalizes unsafe non-form values before display', () => {
    const [server] = applyServerDisplayNames(
      [{ id: 'default', environmentDisplayName: 'Primary\u202e  Server' }],
      {}
    )

    expect(server.displayName).toBe('Primary Server')
  })
})