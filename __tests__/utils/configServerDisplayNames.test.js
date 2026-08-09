const ORIGINAL_ENV = process.env

describe('server display-name environment mapping', () => {
  beforeEach(() => {
    jest.resetModules()
    process.env = {
      ...ORIGINAL_ENV,
      FILE_SERVER_URL: 'https://primary.example.test',
      NODE_SERVER_URL: 'https://primary.example.test/node',
      NODE_SERVER_URL_2: 'https://remote.example.test/node',
      FILE_SERVER_URL_2: 'https://remote.example.test',
      SERVER_DISPLAY_NAME: 'Primary Library',
      SERVER_DISPLAY_NAME_1: 'Ignored Name',
      SERVER_DISPLAY_NAME_2: 'Remote Library',
      SERVER_DISPLAY_NAME_3: 'Unconfigured Library',
    }
  })

  afterAll(() => {
    process.env = ORIGINAL_ENV
  })

  test('matches display-name suffixes to configured immutable server IDs', () => {
    let getAllServers
    jest.isolateModules(() => {
      ;({ getAllServers } = require('@src/utils/config'))
    })

    const servers = getAllServers()
    expect(servers.map((server) => ({
      id: server.id,
      name: server.environmentDisplayName,
      variable: server.displayNameEnvironmentVariable,
    }))).toEqual([
      { id: 'default', name: 'Primary Library', variable: 'SERVER_DISPLAY_NAME' },
      { id: 'server2', name: 'Remote Library', variable: 'SERVER_DISPLAY_NAME_2' },
    ])
  })
})