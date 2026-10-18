/**
 * @jest-environment node
 *
 * Pre-tag, the missing-media report and cleanup's no-server-data guard read
 * each server's listing (run/listing): its titles, seasons and episodes by key.
 * From a payload, the listing must give them exactly the keys they read from
 * the payload itself before, so they stamp, report and guard the same.
 */

const mockDb = { collections: {} }

jest.mock('@src/lib/mongodb', () => ({
  __esModule: true,
  default: Promise.resolve({ db: () => ({ collection: (name) => mockDb.collections[name] }) }),
}))
jest.mock('@src/lib/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
  logError: jest.fn(),
}))

const { listingOfPayload, listingsOfFileServers } = require('@src/utils/sync/run/listing')
const { preTagSyncRunId } = require('@src/utils/sync/run/preTag')
const { computeMissingMedia } = require('@src/utils/sync/run/missingMedia')
const { buildFieldAvailability } = require('@src/utils/sync/run/availability')

// Two servers, with what a payload can hold: integer-like and prototype-key
// folder names, seasons the pre-tag regex misses ("Season01", "Specials"),
// null seasons and episodes, a season without an episodes map, an episode key
// the episode regex misses, and a show no FlatTVShows document has.
const fileServers = () => ({
  A: {
    movies: JSON.parse('{"Film":{"urls":{}},"1917":{"urls":{}},"__proto__":{"urls":{}},"constructor":{}}'),
    tv: {
      'Show One': {
        seasons: {
          'Season 1': { episodes: { S01E01: { videoURL: '/a.mkv' }, S01E02: null, 'S01E03 - extra': {} } },
          Season01: { episodes: { S01E04: {} } },
          Specials: { episodes: { S00E01: {} } },
          'Season 2': null,
          'Season 3': { episodes: null },
          'Season 4': {},
        },
      },
      'No Seasons': {},
      'Null Seasons': { seasons: null },
      'Missing Show': { seasons: { 'Season 1': { episodes: { S01E01: {} } } } },
    },
  },
  B: {
    movies: { Film: {}, Other: {} },
    tv: {
      'Show One': { seasons: { 'Season 1': { episodes: { S01E01: {}, s01e05: {} } }, 'Season 10': { episodes: { S10E01: {} } } } },
    },
  },
})

/** Today's pre-tag key loop over payloads, verbatim, as the reference. */
function referenceNeeds(servers) {
  const movieTitles = new Set()
  const showOriginalTitles = new Set()
  const seasonNeeds = []
  const episodeNeeds = []
  for (const fs of Object.values(servers || {})) {
    if (fs?.movies) {
      for (const t of Object.keys(fs.movies)) movieTitles.add(t)
    }
    if (!fs?.tv) continue
    for (const [origTitle, showData] of Object.entries(fs.tv)) {
      showOriginalTitles.add(origTitle)
      if (!showData?.seasons) continue
      for (const [seasonKey, seasonData] of Object.entries(showData.seasons)) {
        const sm = seasonKey.match(/Season (\d+)/)
        if (!sm) continue
        const seasonNumber = parseInt(sm[1], 10)
        seasonNeeds.push({ origTitle, seasonNumber })
        if (!seasonData?.episodes) continue
        for (const epKey of Object.keys(seasonData.episodes)) {
          const em = epKey.match(/E(\d+)$/i)
          if (!em) continue
          episodeNeeds.push({ origTitle, seasonNumber, episodeNumber: parseInt(em[1], 10) })
        }
      }
    }
  }
  return { movies: [...movieTitles], shows: [...showOriginalTitles], seasonNeeds, episodeNeeds }
}

const showId = (title) => (title === 'Missing Show' ? null : `id:${title}`)

/** The writes pre-tag must make for the reference needs, and its coverage counts. */
function expectedPreTag(needs, syncRunId) {
  const chunked = (list, key, filter) => {
    const seen = new Set()
    const ops = []
    let needsSeen = 0
    for (const need of list) {
      const k = key(need)
      if (seen.has(k)) continue
      seen.add(k)
      needsSeen++
      const id = showId(need.origTitle)
      if (id) ops.push({ updateOne: { filter: filter(id, need), update: { $set: { syncRunId } } } })
    }
    return { ops, needsSeen }
  }
  return {
    movies: { originalTitle: { $in: needs.movies } },
    shows: { originalTitle: { $in: needs.shows } },
    seasons: chunked(needs.seasonNeeds, (n) => `${n.origTitle}|${n.seasonNumber}`, (id, n) => ({ showId: id, seasonNumber: n.seasonNumber })),
    episodes: chunked(
      needs.episodeNeeds,
      (n) => `${n.origTitle}|${n.seasonNumber}|${n.episodeNumber}`,
      (id, n) => ({ showId: id, seasonNumber: n.seasonNumber, episodeNumber: n.episodeNumber })
    ),
  }
}

function installDb({ movieDocs = [], showDocs = [] } = {}) {
  const writes = { updateMany: {}, bulkWrite: {} }
  const collection = (name) => ({
    updateMany: jest.fn(async (filter, update) => {
      writes.updateMany[name] = { filter, update }
      return { modifiedCount: 0 }
    }),
    bulkWrite: jest.fn(async (ops) => {
      writes.bulkWrite[name] = [...(writes.bulkWrite[name] || []), ...ops]
      return { modifiedCount: 0 }
    }),
    find: jest.fn((filter) => ({
      toArray: async () => {
        if (name === 'FlatTVShows' && filter?.originalTitle?.$in) {
          return filter.originalTitle.$in.filter((t) => showId(t)).map((t) => ({ _id: showId(t), originalTitle: t }))
        }
        return name === 'FlatMovies' ? movieDocs : showDocs
      },
    })),
  })
  mockDb.collections = Object.fromEntries(
    ['FlatMovies', 'FlatTVShows', 'FlatSeasons', 'FlatEpisodes'].map((name) => [name, collection(name)])
  )
  return writes
}

describe('listingOfPayload', () => {
  it('keeps every folder name, seasons and episodes by the processor manifest rule', () => {
    const listing = listingOfPayload(fileServers().A)
    expect([...listing.movies]).toEqual(['1917', 'Film', '__proto__', 'constructor'])
    expect([...listing.tv.keys()]).toEqual(['Show One', 'No Seasons', 'Null Seasons', 'Missing Show'])
    expect(Object.fromEntries(listing.tv.get('Show One'))).toEqual({
      'Season 1': ['S01E01', 'S01E02', 'S01E03 - extra'],
      Season01: ['S01E04'],
      Specials: ['S00E01'],
      'Season 2': [],
      'Season 3': [],
      'Season 4': [],
    })
    expect(listing.tv.get('No Seasons').size).toBe(0)
    expect(listing.tv.get('Null Seasons').size).toBe(0)
  })

  it('leaves out the list version key, which shadows a folder of that name', () => {
    const listing = listingOfPayload({ movies: { version: 1.0001, Film: {} }, tv: { version: {}, Show: {} } })
    expect([...listing.movies]).toEqual(['Film'])
    expect([...listing.tv.keys()]).toEqual(['Show'])
  })

  it('lists nothing under seasons or episodes that are not objects, as the manifest does', () => {
    const listing = listingOfPayload({ tv: { A: { seasons: ['Season 1'] }, B: { seasons: { 'Season 1': { episodes: ['S01E01'] } } } } })
    expect(listing.tv.get('A').size).toBe(0)
    expect(listing.tv.get('B').get('Season 1')).toEqual([])
  })
})

describe('pre-tag from listings', () => {
  it('stamps exactly what it stamped from the payloads, with the same coverage', async () => {
    const writes = installDb()
    const servers = fileServers()
    const expected = expectedPreTag(referenceNeeds(servers), 'run-1')

    const result = await preTagSyncRunId(listingsOfFileServers(servers), 'run-1')

    expect(writes.updateMany.FlatMovies.filter).toEqual(expected.movies)
    expect(writes.updateMany.FlatTVShows.filter).toEqual(expected.shows)
    expect(writes.bulkWrite.FlatSeasons).toEqual(expected.seasons.ops)
    expect(writes.bulkWrite.FlatEpisodes).toEqual(expected.episodes.ops)
    expect(result.coverage.seasons).toMatchObject({ needsSeen: expected.seasons.needsSeen, opsBuilt: expected.seasons.ops.length })
    expect(result.coverage.episodes).toMatchObject({ needsSeen: expected.episodes.needsSeen, opsBuilt: expected.episodes.ops.length })
    // The show without a document keeps the TV collections from being cleaned, as before
    expect(result.ok).toBe(false)
    expect(result.coverage.episodes.unkeyableShows).toEqual(['Missing Show'])
  })

  it('reports no server data for empty listings, and for none', async () => {
    installDb()
    expect(await preTagSyncRunId(new Map([['A', { movies: new Set(), tv: new Map() }]]), 'run-1')).toMatchObject({ ok: true, skipped: true })
    expect(await preTagSyncRunId(undefined, 'run-1')).toMatchObject({ ok: true, skipped: true })
  })
})

/** Today's missing-media walk over a payload, as the reference. */
function referenceMissing(fileServer, fieldAvailability, dbMovieTitles, dbShowTitles) {
  const missingMovies = []
  for (const title of Object.keys(fileServer.movies)) {
    if (dbMovieTitles.has(title)) continue
    const fa = fieldAvailability?.movies?.[title]
    if (fa) {
      if ((fa['urls.mp4'] || []).length > 0) missingMovies.push(title)
    } else {
      missingMovies.push(title)
    }
  }
  const missingTVShows = []
  for (const showTitle of Object.keys(fileServer.tv)) {
    if (dbShowTitles.has(showTitle)) continue
    const showData = fileServer.tv[showTitle]
    const seasonCount = showData?.seasons ? Object.keys(showData.seasons).length : 0
    if (seasonCount > 0) missingTVShows.push({ title: showTitle, seasons: seasonCount })
  }
  return { missingMovies, missingTVShows }
}

describe('the missing-media report from a listing', () => {
  it('names what it named from the payload', async () => {
    installDb({
      movieDocs: [{ title: 'Pretty Film', originalTitle: 'Film' }],
      showDocs: [{ title: 'Pretty Show', originalTitle: 'Show One' }],
    })
    const servers = fileServers()
    servers.A.movies['Has Video'] = { urls: { mp4: '/m.mkv' } }
    const fieldAvailability = await buildFieldAvailability(servers)

    const result = await computeMissingMedia(listingOfPayload(servers.A), fieldAvailability)

    expect(result).toEqual(
      referenceMissing(servers.A, fieldAvailability, new Set(['Pretty Film', 'Film']), new Set(['Pretty Show', 'Show One']))
    )
    expect(result.missingMovies).toEqual(['Has Video'])
    expect(result.missingTVShows).toEqual([{ title: 'Missing Show', seasons: 1 }])
  })
})
