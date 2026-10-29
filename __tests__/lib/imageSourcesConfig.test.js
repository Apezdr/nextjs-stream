/**
 * @jest-environment node
 *
 * The image source rules built from the real server config
 * (src/utils/config.js), which reads FILE_SERVER_URL / NODE_SERVER_URL and
 * their _N variants once, when the module loads.
 */

const SERVER_ENV = {
  FILE_SERVER_URL: 'https://files.example.com/media/',
  NODE_SERVER_URL: 'https://files.example.com/node',
  NODE_SERVER_URL_2: 'http://192.168.1.20:3000',
  FILE_SERVER_URL_2: 'http://media.lan.example:8080',
  // a third server with a processor but no file server of its own
  NODE_SERVER_URL_3: 'https://three.example/nodejs',
}

function loadWithEnv(env) {
  const saved = {}
  for (const [name, value] of Object.entries(env)) {
    saved[name] = process.env[name]
    process.env[name] = value
  }
  let isAllowedImageSource
  try {
    jest.isolateModules(() => {
      ;({ isAllowedImageSource } = require('@src/lib/imageSources'))
    })
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
  return isAllowedImageSource
}

describe('image sources from the real server config', () => {
  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => {})
    jest.spyOn(console, 'log').mockImplementation(() => {})
  })
  afterEach(() => jest.restoreAllMocks())

  it('allows each FILE_SERVER_URL[_N] origin and each NODE_SERVER_URL[_N] /frame/ path', () => {
    const allowed = loadWithEnv(SERVER_ENV)
    expect(allowed('https://files.example.com/media/movies/x/poster.jpg')).toBe(true)
    expect(allowed('http://media.lan.example:8080/tv/x/season1.jpg')).toBe(true)
    expect(allowed('https://three.example/nodejs/frame/movie/x/00:10:00.jpg')).toBe(true)
    expect(allowed('http://192.168.1.20:3000/frame/tv/x/1/1/00:05:00.jpg')).toBe(true)
  })

  it('does not stretch a processor rule past its /frame/ path', () => {
    const allowed = loadWithEnv(SERVER_ENV)
    expect(allowed('https://three.example/nodejs/api/sync')).toBe(false)
    expect(allowed('https://three.example/movies/x.jpg')).toBe(false)
    expect(allowed('http://192.168.1.20:3000/api/sync')).toBe(false)
  })
})
