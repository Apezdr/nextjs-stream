/**
 * @jest-environment node
 *
 * Who owns a field when several file servers report it, and the fingerprint
 * that tells a server its ownership may have changed.
 */

const mockServers = {
  main: { id: 'main', priority: 1 },
  second: { id: 'second', priority: 2 },
  twinA: { id: 'twinA', priority: 5 },
  twinB: { id: 'twinB', priority: 5 },
}

jest.mock('@src/utils/config', () => ({
  getServer: jest.fn((id) => {
    if (!mockServers[id]) throw new Error(`unknown server ${id}`)
    return mockServers[id]
  }),
  multiServerHandler: { getHandler: jest.fn() },
}))
jest.mock('@src/utils/sync/captions', () => ({ sortSubtitleEntries: jest.fn() }))

const {
  isCurrentServerHighestPriorityForField,
  isHighestPriorityAmongServers,
  isCurrentServerHighestPriorityForReportedField,
  isCurrentServerHighestPriorityForReportedFieldGroup,
  getServersReportingField,
  availabilityFingerprint,
  availabilityFingerprintForPrefix,
  availabilityFingerprintForPrefixes,
  seasonsAcrossServers,
  serverOutranks,
  getServersReportingTitle,
} = require('@src/utils/sync/utils')

const server = (id) => mockServers[id]
const availability = (paths) => ({ movies: { Film: paths }, tv: {} })

describe('isHighestPriorityAmongServers', () => {
  it('is the lowest priority number among the servers that have the value', () => {
    expect(isHighestPriorityAmongServers(['main', 'second'], server('main'))).toBe(true)
    expect(isHighestPriorityAmongServers(['main', 'second'], server('second'))).toBe(false)
    expect(isHighestPriorityAmongServers(['second'], server('second'))).toBe(true)
  })

  it('is never a server that does not have the value, whatever its priority', () => {
    expect(isHighestPriorityAmongServers(['second'], server('main'))).toBe(false)
    expect(isHighestPriorityAmongServers([], server('main'))).toBe(false)
    expect(isHighestPriorityAmongServers(undefined, server('main'))).toBe(false)
  })

  it('separates two servers with the same priority by id, so order cannot matter', () => {
    expect(isHighestPriorityAmongServers(['twinA', 'twinB'], server('twinA'))).toBe(true)
    expect(isHighestPriorityAmongServers(['twinA', 'twinB'], server('twinB'))).toBe(false)
    expect(isHighestPriorityAmongServers(['twinB', 'twinA'], server('twinB'))).toBe(false)
  })

  it('does not let a reporter that is not a configured server outrank one that is', () => {
    expect(isHighestPriorityAmongServers(['second', 'removed-server'], server('second'))).toBe(true)
  })
})

describe('the reported-field checks', () => {
  const fa = availability({ 'urls.mp4': ['second'], 'urls.poster': ['main', 'second'] })

  it('the legacy check lets a server without the field through — the reason these exist', () => {
    expect(isCurrentServerHighestPriorityForField(fa, 'movies', 'Film', 'urls.mp4', server('main'))).toBe(true)
  })

  it('fails closed for a server that did not report the field', () => {
    expect(isCurrentServerHighestPriorityForReportedField(fa, 'movies', 'Film', 'urls.mp4', server('main'))).toBe(false)
    expect(isCurrentServerHighestPriorityForReportedField(fa, 'movies', 'Film', 'urls.mp4', server('second'))).toBe(true)
  })

  it('fails closed for a path nobody reported, and for a title that is not there', () => {
    expect(isCurrentServerHighestPriorityForReportedField(fa, 'movies', 'Film', 'urls.logo', server('main'))).toBe(false)
    expect(isCurrentServerHighestPriorityForReportedField(fa, 'movies', 'Other', 'urls.mp4', server('second'))).toBe(false)
    expect(isCurrentServerHighestPriorityForReportedField(undefined, 'movies', 'Film', 'urls.mp4', server('second'))).toBe(false)
  })

  it('ranks the servers that both report it', () => {
    expect(isCurrentServerHighestPriorityForReportedField(fa, 'movies', 'Film', 'urls.poster', server('main'))).toBe(true)
    expect(isCurrentServerHighestPriorityForReportedField(fa, 'movies', 'Film', 'urls.poster', server('second'))).toBe(false)
  })

  it('treats equivalent paths as one field', () => {
    const sizes = availability({ 'additional_metadata.size.kb': ['main'], 'additional_metadata.size.gb': ['second'] })
    const paths = ['additional_metadata.size.kb', 'additional_metadata.size.gb']
    expect(isCurrentServerHighestPriorityForReportedFieldGroup(sizes, 'movies', 'Film', paths, server('main'))).toBe(true)
    expect(isCurrentServerHighestPriorityForReportedFieldGroup(sizes, 'movies', 'Film', paths, server('second'))).toBe(false)
  })

  it('lists the servers reporting a field', () => {
    expect(getServersReportingField(fa, 'movies', 'Film', 'urls.poster')).toEqual(['main', 'second'])
    expect(getServersReportingField(fa, 'movies', 'Film', 'urls.logo')).toEqual([])
    expect(getServersReportingField(null, 'movies', 'Film', 'urls.poster')).toEqual([])
  })
})

describe('availabilityFingerprint', () => {
  const base = { 'urls.mp4': ['main', 'second'], 'urls.poster': ['main'] }
  const print = (paths) => availabilityFingerprint(availability(paths), 'movies', 'Film')

  it('is the same for the same picture, however it is ordered', () => {
    expect(print(base)).toBe(print({ 'urls.poster': ['main'], 'urls.mp4': ['second', 'main'] }))
    expect(print(base)).toMatch(/^[0-9a-f]{16}$/)
  })

  it('changes when a server gains or loses a field', () => {
    expect(print({ ...base, 'urls.mp4': ['second'] })).not.toBe(print(base))
    expect(print({ ...base, 'urls.logo': ['second'] })).not.toBe(print(base))
    expect(print({ 'urls.mp4': ['main', 'second'] })).not.toBe(print(base))
  })

  it('changes when a reporting server is given a different priority', () => {
    const before = print(base)
    mockServers.second.priority = 0
    try {
      expect(print(base)).not.toBe(before)
    } finally {
      mockServers.second.priority = 2
    }
  })

  it('is stable for a title nobody reports', () => {
    expect(availabilityFingerprint({ movies: {}, tv: {} }, 'movies', 'Film')).toBe(print({}))
    expect(availabilityFingerprint(undefined, 'movies', 'Film')).toBe(print({}))
  })
})

describe('availabilityFingerprintForPrefixes', () => {
  const E1 = 'seasons.Season 1.episodes.S01E01.'
  const E1_PADDED = 'seasons.Season 01.episodes.S01E01.'
  const E2 = 'seasons.Season 1.episodes.S01E02.'
  const E10 = 'seasons.Season 1.episodes.S01E10.'
  const show = (paths) => ({ movies: {}, tv: { Show: paths } })
  const base = {
    [`${E1}videoURL`]: ['main'],
    [`${E1_PADDED}videoURL`]: ['second'],
    [`${E2}videoURL`]: ['main'],
    [`${E10}videoURL`]: ['main'],
    poster: ['main'],
  }
  const print = (paths, prefixes) => availabilityFingerprintForPrefixes(show(paths), 'tv', 'Show', prefixes)

  it('covers one episode under every name its season folder goes by', () => {
    const both = print(base, [E1, E1_PADDED])
    expect(both).toMatch(/^[0-9a-f]{16}$/)
    expect(print({ ...base, [`${E1_PADDED}videoURL`]: ['main', 'second'] }, [E1, E1_PADDED])).not.toBe(both)
    expect(print({ ...base, [`${E1}thumbnail`]: ['main'] }, [E1, E1_PADDED])).not.toBe(both)
  })

  it('does not move when a different episode or the show itself changes', () => {
    const before = print(base, [E1, E1_PADDED])
    const changedElsewhere = { ...base, [`${E2}videoURL`]: ['second'], [`${E10}thumbnail`]: ['main'], logo: ['main'] }
    expect(print(changedElsewhere, [E1, E1_PADDED])).toBe(before)
  })

  it('does not take "S01E10" for part of "S01E01"', () => {
    const before = print(base, [E1])
    expect(print({ ...base, [`${E10}videoURL`]: ['second'] }, [E1])).toBe(before)
  })

  it('does not depend on the order or repetition of the prefixes', () => {
    expect(print(base, [E1_PADDED, E1, E1])).toBe(print(base, [E1, E1_PADDED]))
  })

  it('matches the single-prefix form, and is stable when there is nothing to cover', () => {
    expect(print(base, [E1])).toBe(availabilityFingerprintForPrefix(show(base), 'tv', 'Show', E1))
    expect(print(base, [])).toBe(print({}, [E1]))
    expect(availabilityFingerprintForPrefixes(undefined, 'tv', 'Show', [E1])).toBe(print({}, [E1]))
  })
})

describe('seasonsAcrossServers', () => {
  const show = (paths) => ({ movies: {}, tv: { Show: paths } })

  it('groups differently named folders of the same season, with the episodes under any of them', () => {
    const seasons = seasonsAcrossServers(
      show({
        'seasons.Season 1.episodes.S01E01.videoURL': ['main'],
        'seasons.Season 1.season_poster': ['main'],
        'seasons.Season 01.episodes.S01E01.videoURL': ['second'],
        'seasons.Season 01.episodes.S01E02.videoURL': ['second'],
        'seasons.Season 2.episodes.S02E01.videoURL': ['main'],
        poster: ['main'],
      }),
      'Show'
    )

    expect([...seasons.keys()].sort()).toEqual([1, 2])
    expect(seasons.get(1).keys.sort()).toEqual(['Season 01', 'Season 1'])
    expect([...seasons.get(1).episodes].sort()).toEqual(['S01E01', 'S01E02'])
    expect(seasons.get(2).keys).toEqual(['Season 2'])
  })

  it('reads a folder whose name contains a dot', () => {
    const seasons = seasonsAcrossServers(show({ 'seasons.Season 1.5.episodes.S01E01.videoURL': ['main'] }), 'Show')
    expect(seasons.get(1).keys).toEqual(['Season 1.5'])
    expect([...seasons.get(1).episodes]).toEqual(['S01E01'])
  })

  it('leaves out a folder with no season number in its name', () => {
    const seasons = seasonsAcrossServers(show({ 'seasons.Specials.episodes.Extra.videoURL': ['main'] }), 'Show')
    expect(seasons.size).toBe(0)
  })

  it('is empty for a show nobody reports', () => {
    expect(seasonsAcrossServers(show({}), 'Other').size).toBe(0)
    expect(seasonsAcrossServers(undefined, 'Show').size).toBe(0)
  })
})

describe('serverOutranks', () => {
  it('is true for the lower priority number', () => {
    expect(serverOutranks(server('main'), 'second')).toBe(true)
    expect(serverOutranks(server('second'), 'main')).toBe(false)
  })

  it('separates equal priorities by id', () => {
    expect(serverOutranks(server('twinA'), 'twinB')).toBe(true)
    expect(serverOutranks(server('twinB'), 'twinA')).toBe(false)
  })

  it('is false against itself, and against anything that is not a configured server', () => {
    expect(serverOutranks(server('main'), 'main')).toBe(false)
    expect(serverOutranks(server('main'), 'removed-server')).toBe(false)
    expect(serverOutranks(server('main'), 'backfill')).toBe(false)
    expect(serverOutranks(server('main'), undefined)).toBe(false)
  })
})

describe('getServersReportingTitle', () => {
  it('lists every server that reported anything for the title, once each', () => {
    const fa = availability({ 'urls.mp4': ['second'], 'urls.poster': ['main', 'second'], hdr: ['main'] })
    expect(getServersReportingTitle(fa, 'movies', 'Film').sort()).toEqual(['main', 'second'])
  })

  it('is empty for a title nobody reports', () => {
    expect(getServersReportingTitle(availability({}), 'movies', 'Film')).toEqual([])
    expect(getServersReportingTitle(availability({}), 'movies', 'Other')).toEqual([])
    expect(getServersReportingTitle(undefined, 'movies', 'Film')).toEqual([])
  })
})
