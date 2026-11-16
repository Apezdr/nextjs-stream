/**
 * Where the web player starts: the pure half (resumePosition.js) and the hook
 * over it (useResumePosition.js).
 *
 * The order: an explicit `?start=` (a present zero is a restart), then the
 * server's row, asked for on every mount, then what the page knew when the
 * server gives no answer in time. Nothing is read from the browser's storage:
 * the entry a tab used to keep there could be another account's, or older
 * than the row, and the player saved from wherever it started.
 */
import { renderHook, act } from '@testing-library/react'

const { parseExplicitStart, resolveResume, fetchServerResume } = require('@src/components/MediaPlayer/resumePosition')
const useResumePosition = require('@src/components/MediaPlayer/useResumePosition').default

const VIDEO_URL = 'https://files.example/movies/film/film.mp4'
const MEDIA_ID = 'mid:film'
const USER = 'user-1'
const ROW_URL = `/api/authenticated/sync/playback?mediaId=${encodeURIComponent(MEDIA_ID)}&videoId=${encodeURIComponent(VIDEO_URL)}`

const answerWith = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body })
const row = (playbackTime, completed = false) => answerWith({ found: true, playbackTime, completed, lastUpdated: '2026-11-16T20:00:00.000Z' })
const noRow = () => answerWith({ found: false, playbackTime: 0, completed: false })

describe('parseExplicitStart', () => {
  it('treats a present zero as an explicit restart, absent as null', () => {
    expect(parseExplicitStart('0')).toBe(0)
    expect(parseExplicitStart(0)).toBe(0)
    expect(parseExplicitStart('125.5')).toBe(125.5)
    expect(parseExplicitStart(null)).toBeNull()
    expect(parseExplicitStart(undefined)).toBeNull()
    expect(parseExplicitStart('')).toBeNull()
    expect(parseExplicitStart(false)).toBeNull()
    expect(parseExplicitStart('abc')).toBeNull()
    expect(parseExplicitStart('-5')).toBeNull()
  })
})

describe('resolveResume: the order', () => {
  const found = (playbackTime, completed = false) => ({ kind: 'row', playbackTime, completed })
  const everything = { answer: found(900), lastKnownPosition: 700, savedPlaybackTime: 500 }

  it('1. an explicit start, zero included, outranks everything', () => {
    expect(resolveResume({ ...everything, explicitStart: 0 })).toBe(0)
    expect(resolveResume({ ...everything, explicitStart: 42 })).toBe(42)
  })

  it('2. the server’s row: its position, whatever the page knew', () => {
    expect(resolveResume(everything)).toBe(900)
    // The row moved back on another device: that is where the viewer is
    expect(resolveResume({ answer: found(120), lastKnownPosition: 700, savedPlaybackTime: 500 })).toBe(120)
  })

  it('2. a finished title starts over, and never from where it finished', () => {
    expect(resolveResume({ answer: found(7100, true), lastKnownPosition: 7100, savedPlaybackTime: 7100 })).toBe(0)
  })

  it('2. no row means the top, whatever the page knew', () => {
    expect(resolveResume({ answer: { kind: 'none' }, lastKnownPosition: 700, savedPlaybackTime: 500 })).toBeNull()
    expect(resolveResume({ answer: found(0) })).toBeNull()
  })

  it('3. no answer: where this page’s own player last was, which is later knowledge than its render', () => {
    expect(resolveResume({ answer: { kind: 'unavailable' }, lastKnownPosition: 3600, savedPlaybackTime: 500 })).toBe(3600)
    expect(resolveResume({ answer: null, lastKnownPosition: 3600, savedPlaybackTime: 500 })).toBe(3600)
  })

  it('3. no answer on a page that has not played: the position it was rendered with, else the top', () => {
    expect(resolveResume({ answer: { kind: 'unavailable' }, lastKnownPosition: null, savedPlaybackTime: 500 })).toBe(500)
    expect(resolveResume({ answer: { kind: 'unavailable' }, savedPlaybackTime: 0 })).toBeNull()
    expect(resolveResume({ answer: { kind: 'unavailable' } })).toBeNull()
    expect(resolveResume()).toBeNull()
  })
})

describe('fetchServerResume', () => {
  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue(row(900))
  })

  it('asks for the title by its durable id and its URL, naming the user the page was rendered for', async () => {
    expect(await fetchServerResume({ videoURL: VIDEO_URL, mediaId: MEDIA_ID, userId: USER })).toEqual({ kind: 'row', playbackTime: 900, completed: false })

    const [url, init] = global.fetch.mock.calls[0]
    expect(url).toBe(ROW_URL)
    expect(init.headers).toEqual({ Accept: 'application/json', 'X-Playback-User': USER })
    expect(init.cache).toBe('no-store')
  })

  it('a title with no durable id is asked for by its URL alone', async () => {
    await fetchServerResume({ videoURL: VIDEO_URL, mediaId: '64b7f0c2a1b2c3d4e5f60799', userId: USER })
    expect(global.fetch.mock.calls[0][0]).toBe(`/api/authenticated/sync/playback?videoId=${encodeURIComponent(VIDEO_URL)}`)
  })

  it('tells a finished row and "no row" apart', async () => {
    global.fetch.mockResolvedValue(row(7100, true))
    expect(await fetchServerResume({ videoURL: VIDEO_URL, userId: USER })).toEqual({ kind: 'row', playbackTime: 7100, completed: true })
    global.fetch.mockResolvedValue(noRow())
    expect(await fetchServerResume({ videoURL: VIDEO_URL, userId: USER })).toEqual({ kind: 'none' })
  })

  it.each([
    ['a 500', () => answerWith({ error: 'Failed to read the playback position' }, 500)],
    ['a refusal: signed out (401)', () => answerWith({ code: 'AUTH_REQUIRED' }, 401)],
    ['a refusal: another account’s session now (409)', () => answerWith({ error: 'USER_MISMATCH' }, 409)],
    ['a refusal: a request that names no user (400)', () => answerWith({ error: 'PLAYBACK_USER_REQUIRED' }, 400)],
  ])('%s is no answer, never "no row"', async (_name, response) => {
    global.fetch.mockResolvedValue(response())
    expect(await fetchServerResume({ videoURL: VIDEO_URL, userId: USER })).toEqual({ kind: 'unavailable' })
  })

  it('a network failure is no answer, and nothing is thrown', async () => {
    global.fetch.mockRejectedValue(new TypeError('Failed to fetch'))
    expect(await fetchServerResume({ videoURL: VIDEO_URL, userId: USER })).toEqual({ kind: 'unavailable' })
  })

  it('an answer slower than the deadline is no answer: the request is aborted', async () => {
    jest.useFakeTimers()
    try {
      let aborted = false
      global.fetch.mockImplementation(
        (_url, { signal }) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => {
              aborted = true
              reject(new DOMException('Aborted', 'AbortError'))
            })
          })
      )
      const asked = fetchServerResume({ videoURL: VIDEO_URL, userId: USER })
      jest.advanceTimersByTime(1499)
      expect(aborted).toBe(false)
      jest.advanceTimersByTime(1)
      expect(aborted).toBe(true)
      expect(await asked).toEqual({ kind: 'unavailable' })
    } finally {
      jest.useRealTimers()
    }
  })

  it('with no URL there is nothing to ask', async () => {
    expect(await fetchServerResume({ videoURL: null, mediaId: MEDIA_ID, userId: USER })).toEqual({ kind: 'unavailable' })
    expect(global.fetch).not.toHaveBeenCalled()
  })
})

describe('useResumePosition', () => {
  const page = { explicitStart: null, savedPlaybackTime: 500, mediaId: MEDIA_ID, videoURL: VIDEO_URL, castingThisTitle: false, userId: USER }

  async function settle() {
    await act(async () => {
      for (let i = 0; i < 20; i++) await Promise.resolve()
    })
  }

  beforeEach(() => {
    window.localStorage.clear()
    global.fetch = jest.fn().mockResolvedValue(row(900))
  })

  it('every mount asks the server, the first one too, and holds the player until it answers', async () => {
    const { result } = renderHook(() => useResumePosition(page))
    expect(result.current).toEqual({ ready: false, resumeAt: null })
    expect(global.fetch).toHaveBeenCalledTimes(1)
    expect(global.fetch.mock.calls[0][0]).toBe(ROW_URL)
    expect(global.fetch.mock.calls[0][1].headers['X-Playback-User']).toBe(USER)

    await settle()
    // The row, not the position the page was rendered with
    expect(result.current).toEqual({ ready: true, resumeAt: 900 })
  })

  it('a newer mount of the same page asks again', async () => {
    const first = renderHook(() => useResumePosition(page))
    await settle()
    first.unmount()

    global.fetch.mockResolvedValue(row(2400))
    const again = renderHook(() => useResumePosition({ ...page, getLastKnownPosition: () => 950 }))
    await settle()
    expect(global.fetch).toHaveBeenCalledTimes(2)
    expect(again.result.current).toEqual({ ready: true, resumeAt: 2400 })
  })

  it('an explicit start is ready at once and asks nothing', () => {
    const { result } = renderHook(() => useResumePosition({ ...page, explicitStart: 0 }))
    expect(result.current).toEqual({ ready: true, resumeAt: 0 })
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('while a receiver has the title the position is the television’s: nothing is asked', () => {
    const { result } = renderHook(() => useResumePosition({ ...page, castingThisTitle: true }))
    expect(result.current).toEqual({ ready: true, resumeAt: null })
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('a finished title starts over; a title with no row starts at the top', async () => {
    global.fetch.mockResolvedValue(row(7100, true))
    const finished = renderHook(() => useResumePosition(page))
    await settle()
    expect(finished.result.current).toEqual({ ready: true, resumeAt: 0 })

    global.fetch.mockResolvedValue(noRow())
    const unwatched = renderHook(() => useResumePosition(page))
    await settle()
    expect(unwatched.result.current).toEqual({ ready: true, resumeAt: null })
  })

  it('no answer on a first mount: the position the page was rendered with', async () => {
    global.fetch.mockResolvedValue(answerWith({}, 503))
    const { result } = renderHook(() => useResumePosition(page))
    await settle()
    expect(result.current).toEqual({ ready: true, resumeAt: 500 })
  })

  it('no answer on a page that has played: where its own player last was, not the hour-old render', async () => {
    global.fetch.mockRejectedValue(new TypeError('Failed to fetch'))
    const getLastKnownPosition = jest.fn(() => 4100)
    const { result } = renderHook(() => useResumePosition({ ...page, getLastKnownPosition }))
    // Read when the answer is in, not while rendering
    expect(getLastKnownPosition).not.toHaveBeenCalled()
    await settle()
    expect(result.current).toEqual({ ready: true, resumeAt: 4100 })
  })

  it('a refusal starts from what the page knew, like any other missing answer', async () => {
    global.fetch.mockResolvedValue(answerWith({ error: 'USER_MISMATCH' }, 409))
    const { result } = renderHook(() => useResumePosition(page))
    await settle()
    expect(result.current).toEqual({ ready: true, resumeAt: 500 })
  })

  it('a cast that adopts the title while it asks gets the television’s position, not the page’s', async () => {
    let fail
    global.fetch.mockImplementation(
      (_url, { signal }) =>
        new Promise((_resolve, reject) => {
          fail = reject
          signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
        })
    )
    const { result, rerender } = renderHook((props) => useResumePosition(props), { initialProps: page })
    expect(result.current.ready).toBe(false)

    rerender({ ...page, castingThisTitle: true })
    await settle()
    expect(fail).toBeDefined()
    expect(result.current).toEqual({ ready: true, resumeAt: null })
  })

  it('reads nothing from the browser’s storage, whatever a tab from before left there', async () => {
    const getItem = jest.spyOn(Storage.prototype, 'getItem')
    window.localStorage.setItem(MEDIA_ID, JSON.stringify({ playbackTime: 6000, lastUpdated: '2030-01-01T00:00:00.000Z' }))
    window.localStorage.setItem(VIDEO_URL, JSON.stringify({ playbackTime: 6000, lastUpdated: '2030-01-01T00:00:00.000Z' }))
    getItem.mockClear()
    global.fetch.mockResolvedValue(noRow())

    const { result } = renderHook(() => useResumePosition({ ...page, savedPlaybackTime: 0 }))
    await settle()

    expect(result.current).toEqual({ ready: true, resumeAt: null })
    expect(getItem).not.toHaveBeenCalled()
    getItem.mockRestore()
  })
})
