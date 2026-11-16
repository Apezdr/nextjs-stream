/**
 * The one-time removal of the playback positions older versions of the app
 * kept in localStorage (components/WatchProgress/removeLocalPlaybackMirror.js).
 *
 * It takes out the mirror's entries and nothing else a feature stores, needs
 * no "done" flag, and never throws at a storage it cannot use. It runs once
 * per document, from the client providers. Temporary: its @removeAtVersion
 * marker says when it goes, and this file goes with it.
 */
import fs from 'fs'
import path from 'path'
import { render } from '@testing-library/react'

jest.mock('@src/contexts/NotificationContext', () => ({ NotificationProvider: ({ children }) => children }))
jest.mock('@src/contexts/SystemStatusContext', () => ({ SystemStatusProvider: ({ children }) => children }))
jest.mock('@src/contexts/NavigationContext', () => ({ NavigationProvider: ({ children }) => children }))
jest.mock('@components/Cast/CastSessionBar', () => ({ __esModule: true, default: () => null }))
jest.mock('@components/VideoPreview/Av1DecodeCheck', () => ({ __esModule: true, default: () => null }))

const { removeLocalPlaybackMirror } = require('@components/WatchProgress/removeLocalPlaybackMirror')
const ClientProviders = require('@components/providers/ClientProviders').default

const position = (playbackTime = 1800) => JSON.stringify({ playbackTime, lastUpdated: '2026-11-10T20:00:00.000Z' })

// What the mirror left: one entry per title, under its durable id and under the URL it played from
const MIRROR = {
  'mid:0123456789abcdef': position(),
  'mid:0123456789abcdef:s01e01': position(42.5),
  'https://files.example/movies/film/film.mp4': position(),
  'http://files.example/tv/show/s01e01.mp4': position(0),
  'https://transcoder.example/stream/bW92aWVz/master.m3u8': JSON.stringify({ playbackTime: '77' }),
}

// Every other key the app stores in localStorage, as its features write them
const KEPT = {
  'cast:last-session': JSON.stringify({ contentId: 'https://files.example/movies/film/film.mp4', at: 1 }),
  'mediaPlayer:hevcBaseline': JSON.stringify({ fps: 24 }),
  'mediaPlayer:decodeNoticeDismissed': '1',
  mediaPlayerCaptionPreference: JSON.stringify({ language: 'en' }),
  videoVolumeMedia: '0.8',
  videoVolumeCard: '0.5',
  videoVolumeBanner: '0.3',
  videoMutedCard: 'true',
  videoMutedBanner: 'false',
  'tv-episodes-view': 'grid',
  'watchlist-view-mode': 'list',
  'arr.lastQualityProfile.radarr': '4',
  playbackDiag: '1',
}

// Under the mirror's prefixes, but not a mirrored position: not ours to remove
const NOT_A_POSITION = {
  'https://files.example/some-other-feature': JSON.stringify({ volume: 1 }),
  'mid:note': 'plain text',
  'https://files.example/a-list': JSON.stringify([{ playbackTime: 5 }]),
  'http://files.example/a-number': '1800',
  'mid:null': 'null',
}

const stored = () => Object.fromEntries(Array.from({ length: window.localStorage.length }, (_, i) => window.localStorage.key(i)).map((key) => [key, window.localStorage.getItem(key)]))

function fill(...groups) {
  window.localStorage.clear()
  for (const group of groups) for (const [key, value] of Object.entries(group)) window.localStorage.setItem(key, value)
}

beforeEach(() => fill(MIRROR, KEPT, NOT_A_POSITION))
afterEach(() => jest.restoreAllMocks())

describe('removeLocalPlaybackMirror', () => {
  it('removes every mid: and URL key that holds a playbackTime, and says how many', () => {
    expect(removeLocalPlaybackMirror()).toBe(Object.keys(MIRROR).length)
    for (const key of Object.keys(MIRROR)) expect([key, window.localStorage.getItem(key)]).toEqual([key, null])
  })

  it('keeps every other key the app stores, value for value', () => {
    removeLocalPlaybackMirror()
    expect(stored()).toEqual({ ...KEPT, ...NOT_A_POSITION })
  })

  it('goes by the value as well as the prefix: a key under mid: or a URL that holds no playbackTime stays', () => {
    fill(NOT_A_POSITION)
    expect(removeLocalPlaybackMirror()).toBe(0)
    expect(stored()).toEqual(NOT_A_POSITION)
  })

  it('a second run removes nothing and writes nothing: no "done" flag', () => {
    removeLocalPlaybackMirror()
    const after = stored()
    const setItem = jest.spyOn(Storage.prototype, 'setItem')
    const removeItem = jest.spyOn(Storage.prototype, 'removeItem')

    expect(removeLocalPlaybackMirror()).toBe(0)
    expect(stored()).toEqual(after)
    expect(setItem).not.toHaveBeenCalled()
    expect(removeItem).not.toHaveBeenCalled()
  })

  it('removes what a tab from before the change wrote once more, on the next run', () => {
    removeLocalPlaybackMirror()
    window.localStorage.setItem('mid:0123456789abcdef', position(1900))
    expect(removeLocalPlaybackMirror()).toBe(1)
    expect(window.localStorage.getItem('mid:0123456789abcdef')).toBeNull()
  })

  it('reads nothing but the entries it tests: no entry’s position is kept, used or sent anywhere', () => {
    global.fetch = jest.fn()
    removeLocalPlaybackMirror()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it.each([
    ['its length cannot be read', (storage) => Object.defineProperty(storage, 'length', { get: () => { throw new Error('SecurityError') } })],
    ['key() throws', (storage) => (storage.key = () => { throw new Error('SecurityError') })],
    ['getItem() throws', (storage) => (storage.getItem = () => { throw new Error('SecurityError') })],
    ['removeItem() throws', (storage) => (storage.removeItem = () => { throw new Error('QuotaExceededError') })],
  ])('survives a storage where %s', (_name, breakIt) => {
    const entries = Object.entries(MIRROR)
    const storage = {
      length: entries.length,
      key: (index) => entries[index]?.[0] ?? null,
      getItem: (key) => MIRROR[key] ?? null,
      removeItem: jest.fn(),
    }
    breakIt(storage)
    expect(() => removeLocalPlaybackMirror(storage)).not.toThrow()
  })

  it('survives a browser with no storage at all, or one that refuses to hand it over', () => {
    expect(removeLocalPlaybackMirror(null)).toBe(0)

    const blocked = jest.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new Error('SecurityError: access is denied for this document')
    })
    expect(() => removeLocalPlaybackMirror()).not.toThrow()
    expect(removeLocalPlaybackMirror()).toBe(0)
    blocked.mockRestore()
  })
})

describe('where it runs', () => {
  it('the client providers run it as the document loads: the mirror is gone, the rest stays', () => {
    render(
      <ClientProviders>
        <p>page</p>
      </ClientProviders>
    )
    expect(stored()).toEqual({ ...KEPT, ...NOT_A_POSITION })
  })

  it('nowhere else, and nothing in src reads what it removes', () => {
    const SRC = path.join(__dirname, '..', '..', 'src')
    const files = (dir) =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) return files(full)
        return /\.(js|jsx|ts|tsx)$/.test(entry.name) ? [full] : []
      })
    const callers = files(SRC)
      .filter((file) => /removeLocalPlaybackMirror\(/.test(fs.readFileSync(file, 'utf8')))
      .map((file) => path.relative(SRC, file).split(path.sep).join('/'))
      .sort()
    expect(callers).toEqual(['components/WatchProgress/removeLocalPlaybackMirror.js', 'components/providers/ClientProviders.js'])
  })
})
