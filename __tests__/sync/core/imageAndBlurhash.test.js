/**
 * @jest-environment node
 *
 * The one rule every image's blurhash follows (a movie's poster and backdrop,
 * a show's poster and backdrop, a season's poster, an episode's thumbnail).
 * See the module header for the rule; each case here is one step of it.
 */

const {
  decideBlurhash,
  settleBlurhash,
  resolveBlurhash,
} = require('@src/utils/sync/core/imageAndBlurhash')

const A_POSTER = 'https://A.example/movies/Film/poster.jpg?hash=p1'
const B_POSTER = 'https://B.example/movies/Film/poster.jpg?hash=p1'
const BLURHASH_FILE = '/movies/Film/poster.jpg.blurhash'
const UNLOCKED = { image: false, blurhash: false }

/** Server A's pass, A owning the poster, unless a case says otherwise. */
const input = ({ stored = {}, reported = {}, owner = 'A', locks = UNLOCKED } = {}) => ({
  stored,
  reported: { url: A_POSTER, blurhashUrl: BLURHASH_FILE, ...reported },
  owner,
  locks,
})

describe('decideBlurhash', () => {
  it('fetches the owner\'s blurhash when none is stored', () => {
    expect(decideBlurhash(input())).toEqual({
      action: 'fetch',
      blurhashUrl: BLURHASH_FILE,
      source: 'A',
      replacesStale: false,
    })
  })

  it('keeps a blurhash of the stored image, without a request', () => {
    const stored = { url: A_POSTER, blurhash: 'LKO2?U', blurhashSource: 'A' }
    expect(decideBlurhash(input({ stored }))).toEqual({ action: 'keep', reason: 'current' })
  })

  it('replaces a blurhash when the image changed', () => {
    const stored = { url: 'https://A.example/movies/Film/poster.jpg?hash=p0', blurhash: 'old', blurhashSource: 'A' }
    expect(decideBlurhash(input({ stored }))).toMatchObject({ action: 'fetch', replacesStale: true })
  })

  it('replaces a blurhash read from another server, even under the same image URL', () => {
    const stored = { url: A_POSTER, blurhash: 'B\'s', blurhashSource: 'B' }
    expect(decideBlurhash(input({ stored }))).toMatchObject({ action: 'fetch', replacesStale: true })
  })

  it('compares the image URL whole, not by its ?hash=, which a copy on another server shares', () => {
    const stored = { url: B_POSTER, blurhash: 'B\'s', blurhashSource: 'A' }
    expect(decideBlurhash(input({ stored }))).toMatchObject({ action: 'fetch', replacesStale: true })
  })

  it('removes a stale blurhash when the owner publishes none for its image', () => {
    const stored = { url: B_POSTER, blurhash: 'B\'s', blurhashSource: 'B' }
    expect(decideBlurhash(input({ stored, reported: { blurhashUrl: null } }))).toEqual({ action: 'unset' })
  })

  it('stores nothing when none is stored and the owner publishes none', () => {
    expect(decideBlurhash(input({ reported: { blurhashUrl: '' } }))).toEqual({
      action: 'keep',
      reason: 'no-blurhash-file',
    })
  })

  it('leaves the blurhash to the image\'s owner', () => {
    const stored = { url: B_POSTER, blurhash: 'B\'s', blurhashSource: 'B' }
    expect(decideBlurhash(input({ stored, owner: null }))).toEqual({ action: 'keep', reason: 'not-owner' })
    expect(decideBlurhash(input({ owner: null }))).toEqual({ action: 'keep', reason: 'not-owner' })
  })

  it('does nothing for a server with no image', () => {
    const stored = { url: B_POSTER, blurhash: 'B\'s', blurhashSource: 'B' }
    expect(decideBlurhash(input({ stored, reported: { url: null } }))).toEqual({ action: 'keep', reason: 'no-image' })
  })

  it('never touches a blurhash when an admin locked the image or the blurhash, stale or not', () => {
    const stored = { url: B_POSTER, blurhash: 'B\'s', blurhashSource: 'B' }
    for (const locks of [{ image: true, blurhash: false }, { image: false, blurhash: true }]) {
      expect(decideBlurhash(input({ stored, locks }))).toEqual({ action: 'keep', reason: 'locked' })
      expect(decideBlurhash(input({ locks }))).toEqual({ action: 'keep', reason: 'locked' })
      expect(decideBlurhash(input({ stored, locks, reported: { blurhashUrl: null } }))).toEqual({ action: 'keep', reason: 'locked' })
    }
  })

  it('reads a blurhash MongoDB stored as null as none', () => {
    const stored = { url: null, blurhash: null, blurhashSource: null }
    expect(decideBlurhash(input({ stored }))).toMatchObject({ action: 'fetch', replacesStale: false })
    expect(decideBlurhash(input({ stored, reported: { blurhashUrl: null } }))).toEqual({
      action: 'keep',
      reason: 'no-blurhash-file',
    })
  })
})

describe('settleBlurhash', () => {
  const fetchFor = (replacesStale) => ({ action: 'fetch', blurhashUrl: BLURHASH_FILE, source: 'A', replacesStale })

  it('stores what was fetched, with the owner as its source', () => {
    expect(settleBlurhash(fetchFor(true), 'LKO2?U')).toEqual({ action: 'write', blurhash: 'LKO2?U', blurhashSource: 'A' })
    expect(settleBlurhash(fetchFor(false), 'LKO2?U')).toEqual({ action: 'write', blurhash: 'LKO2?U', blurhashSource: 'A' })
  })

  it('removes a stale blurhash the fetch could not replace, and reports the failure', () => {
    expect(settleBlurhash(fetchFor(true), null)).toEqual({ action: 'unset', fetchFailed: true })
  })

  it('stores nothing when the fetch for a missing blurhash fails, and reports the failure', () => {
    expect(settleBlurhash(fetchFor(false), null)).toEqual({ action: 'keep', fetchFailed: true })
  })

  it('counts anything but a non-empty string as a failed fetch', () => {
    for (const fetched of ['', undefined, null, {}, 0]) {
      expect(settleBlurhash(fetchFor(false), fetched)).toEqual({ action: 'keep', fetchFailed: true })
    }
  })
})

describe('resolveBlurhash', () => {
  it('fetches only when the decision says so', async () => {
    const fetch = jest.fn(async () => 'LKO2?U')
    const current = { url: A_POSTER, blurhash: 'LKO2?U', blurhashSource: 'A' }

    expect(await resolveBlurhash(input({ stored: current }), fetch)).toEqual({ action: 'keep', fetchFailed: false })
    expect(await resolveBlurhash(input({ owner: null }), fetch)).toEqual({ action: 'keep', fetchFailed: false })
    expect(await resolveBlurhash(input({ stored: { ...current, blurhashSource: 'B' }, reported: { blurhashUrl: null } }), fetch))
      .toEqual({ action: 'unset', fetchFailed: false })
    expect(fetch).not.toHaveBeenCalled()

    expect(await resolveBlurhash(input(), fetch)).toEqual({ action: 'write', blurhash: 'LKO2?U', blurhashSource: 'A' })
    expect(fetch).toHaveBeenCalledWith(BLURHASH_FILE)
  })

  it('removes a stale blurhash when its replacement could not be fetched', async () => {
    const stored = { url: 'https://A.example/movies/Film/poster.jpg?hash=p0', blurhash: 'old', blurhashSource: 'A' }
    expect(await resolveBlurhash(input({ stored }), async () => '')).toEqual({ action: 'unset', fetchFailed: true })
  })

  it('leaves an error the fetch throws to the caller', async () => {
    await expect(resolveBlurhash(input(), async () => { throw new Error('timeout') })).rejects.toThrow('timeout')
  })
})
