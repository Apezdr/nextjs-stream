/**
 * The TV info pages' pure helpers, run against Preacher-shaped fixtures:
 * a show document the way `getFlatRequestedMedia({ type: 'tv' })` returns
 * it (TMDB seasons 0–4, library seasons 1, 2 and 4), the light episode
 * rows `getFlatShowEpisodesForProgress` returns with the joined
 * `watchHistory`, and the season payload's `showSummary`.
 */

const {
  showTitleOf,
  showTypeLabel,
  showEyebrow,
  showYears,
  showStatusChip,
  tvHrefs,
  seasonLabel,
  mergeSeasons,
  seasonsSummary,
  seasonTileStatus,
  pickNextUp,
  nextUpNoun,
  nextUpLine,
  seasonQuality,
  episodeRowChips,
  tvLinks,
  showFacts,
  seasonFacts,
} = require('@src/utils/media/tvFacts')
const { readProgress } = require('@components/WatchProgress/progress')

const DURATION_MS = 3_841_000

const preacher = {
  _id: '64a1f0c2e4b0a1b2c3d4e5f6',
  title: 'Preacher',
  originalTitle: 'Preacher',
  posterURL: 'https://cdn.example/tv/Preacher/poster.jpg',
  posterBlurhash: 'SHOWBLUR',
  visibleEpisodeCount: 13,
  metadata: {
    id: 62741,
    name: 'Preacher',
    overview: 'A preacher with a criminal past and a supernatural power sets out to find God.',
    type: 'Scripted',
    status: 'Ended',
    first_air_date: '2016-05-22',
    last_air_date: '2019-09-29',
    number_of_seasons: 4,
    number_of_episodes: 43,
    in_production: false,
    homepage: 'http://www.amc.com/shows/preacher',
    original_language: 'en',
    origin_country: ['US'],
    vote_average: 7.7,
    vote_count: 1289,
    genres: [{ id: 18, name: 'Drama' }, { id: 10765, name: 'Sci-Fi & Fantasy' }, { id: 9648, name: 'Mystery' }],
    networks: [{ id: 174, name: 'AMC', logo_path: '/amc.png' }],
    created_by: [{ id: 1, name: 'Sam Catlin' }, { id: 2, name: 'Evan Goldberg' }, { id: 3, name: 'Seth Rogen' }],
    production_countries: [{ iso_3166_1: 'US', name: 'United States of America' }],
    seasons: [
      { season_number: 0, name: 'Specials', episode_count: 3, air_date: '2016-05-23', poster_path: '/s0.jpg' },
      { season_number: 1, name: 'Season 1', episode_count: 10, air_date: '2016-05-22', poster_path: '/s1tmdb.jpg' },
      { season_number: 2, name: 'Season 2', episode_count: 13, air_date: '2017-06-25', poster_path: '/s2tmdb.jpg' },
      { season_number: 3, name: 'Season 3', episode_count: 10, air_date: '2018-06-24', poster_path: '/s3tmdb.jpg' },
      { season_number: 4, name: 'Season 4', episode_count: 10, air_date: '2019-08-04', poster_path: '/s4tmdb.jpg' },
    ],
  },
  seasons: [
    {
      _id: 's1',
      seasonNumber: 1,
      title: 'Season 1',
      episodeCount: 10,
      airDate: '2016-05-22T00:00:00.000Z',
      posterURL: 'https://cdn.example/tv/Preacher/s1.jpg',
      posterBlurhash: 'S1BLUR',
      metadata: { air_date: '2016-05-22', episode_count: 10, name: 'Season 1', poster_path: '/s1tmdb.jpg', vote_average: 7.6 },
    },
    {
      // No poster of its own: falls back to TMDB's season poster
      _id: 's2',
      seasonNumber: 2,
      title: 'Season 2',
      episodeCount: 13,
      metadata: { air_date: '2017-06-25', episode_count: 13, name: 'Season 2', poster_path: '/s2lib.jpg', vote_average: 7.4 },
    },
    {
      // In the library, but none of its episodes are visible
      _id: 's4',
      seasonNumber: 4,
      title: 'Season 4',
      episodeCount: 10,
      metadata: { air_date: '2019-08-04', episode_count: 10, name: 'Season 4', vote_average: 7.9 },
    },
  ],
}

const UNWATCHED = { playbackTime: 0, lastWatched: null, isWatched: false, completed: false, progressPercent: 0 }

function ep(seasonNumber, episodeNumber, title, watch = null) {
  const code = `s${String(seasonNumber).padStart(2, '0')}e${String(episodeNumber).padStart(2, '0')}`
  return {
    _id: `e-${code}`,
    seasonId: `s${seasonNumber}`,
    seasonNumber,
    episodeNumber,
    title,
    mediaId: `mid:preacher:${code}`,
    videoURL: `https://cdn.example/tv/Preacher/${code}.mp4`,
    jitUrl: null,
    normalizedVideoId: `nid-${code}`,
    duration: DURATION_MS,
    dimensions: '1920x1080',
    hdr: '10-bit SDR (BT.709)',
    metadata: { runtime: 64, ...(title ? { name: title } : {}) },
    watchHistory: watch ? { ...UNWATCHED, isWatched: true, ...watch } : { ...UNWATCHED },
  }
}

const inProgress = (playbackTime, lastWatched) => ({
  playbackTime,
  lastWatched,
  completed: false,
  progressPercent: Math.round((playbackTime / (DURATION_MS / 1000)) * 1000) / 10,
})
const done = (lastWatched) => ({ playbackTime: 3700, lastWatched, completed: true, progressPercent: 96.3 })

const S1_TITLES = ['Pilot', 'See', 'The Possibilities', 'Monster Swamp', 'South Will Rise Again', 'Sundowner', 'He Gone', 'El Valero', 'Finish the Song', 'Call and Response']

/** S1 with E1 under way (509 s of 3 841 s), S2 finished; S4 has no visible episodes. */
const episodes = [
  ...S1_TITLES.map((title, i) => ep(1, i + 1, title, i === 0 ? inProgress(509, '2026-09-10T20:00:00.000Z') : null)),
  ep(2, 1, 'On the Road', done('2026-08-01T20:00:00.000Z')),
  ep(2, 2, 'Mumbai Sky Tower', done('2026-08-02T20:00:00.000Z')),
  ep(2, 3, 'Damsels', done('2026-08-03T20:00:00.000Z')),
]

describe('showTitleOf', () => {
  it('prefers TMDB name when the title is only the folder name', () => {
    expect(showTitleOf({ title: 'KINGDOM (2019)', originalTitle: 'KINGDOM (2019)', name: 'Kingdom' })).toBe('Kingdom')
    expect(showTitleOf({ title: 'KINGDOM (2019)', originalTitle: 'KINGDOM (2019)', metadata: { name: 'Kingdom' } })).toBe('Kingdom')
    expect(showTitleOf(preacher)).toBe('Preacher')
  })

  it('keeps a title set on purpose, and copes with missing pieces', () => {
    expect(showTitleOf({ title: 'My Name', originalTitle: 'Folder', metadata: { name: 'TMDB Name' } })).toBe('My Name')
    expect(showTitleOf({ title: 'Folder', originalTitle: 'Folder', metadata: {} })).toBe('Folder')
    expect(showTitleOf({ originalTitle: 'Folder' })).toBe('Folder')
    expect(showTitleOf({ title: '  ', originalTitle: 'Folder', name: null, metadata: { name: 'Named' } })).toBe('Named')
    expect(showTitleOf(null)).toBe('')
  })
})

describe('eyebrow, years and status', () => {
  it('labels the type the way a viewer says it', () => {
    expect(showTypeLabel({ type: 'Scripted' })).toBe('Series')
    expect(showTypeLabel({ type: 'Miniseries' })).toBe('Miniseries')
    expect(showTypeLabel({ type: ' Reality ' })).toBe('Reality')
    expect(showTypeLabel({ type: '' })).toBeNull()
    expect(showTypeLabel({})).toBeNull()
    expect(showTypeLabel(null)).toBeNull()
  })

  it('builds the eyebrow from the first network and the type', () => {
    expect(showEyebrow(preacher)).toBe('AMC · Series')
    expect(showEyebrow({ metadata: { type: 'Scripted' } })).toBe('Series')
    expect(showEyebrow({ metadata: { networks: [{ name: 'HBO' }, { name: 'Sky' }] } })).toBe('HBO')
    expect(showEyebrow({ metadata: {} })).toBeNull()
    expect(showEyebrow(null)).toBeNull()
  })

  it('ranges the years, leaving a running show open-ended', () => {
    expect(showYears(preacher.metadata)).toBe('2016–2019')
    expect(showYears({ first_air_date: '2016-05-22', last_air_date: '2016-07-31' })).toBe('2016')
    expect(showYears({ first_air_date: '2016-05-22' })).toBe('2016')
    expect(showYears({ first_air_date: '2016-05-22', last_air_date: '2026-03-01', status: 'Returning Series' })).toBe('2016–')
    expect(showYears({ first_air_date: '2024-01-10', in_production: true })).toBe('2024–')
    expect(showYears({ last_air_date: '2019-09-29' })).toBeNull()
    expect(showYears(null)).toBeNull()
  })

  it('maps the status to a short chip', () => {
    expect(showStatusChip({ status: 'Ended' })).toBe('Ended')
    expect(showStatusChip({ status: 'Returning Series' })).toBe('Returning')
    expect(showStatusChip({ status: 'Canceled' })).toBe('Canceled')
    expect(showStatusChip({ status: 'Cancelled' })).toBe('Canceled')
    expect(showStatusChip({ status: 'In Production' })).toBe('In production')
    expect(showStatusChip({ status: 'Planned' })).toBe('Planned')
    expect(showStatusChip({ status: 'Pilot' })).toBe('Pilot')
    expect(showStatusChip({ status: 'Something Else' })).toBe('Something Else')
    expect(showStatusChip({ status: '' })).toBeNull()
    expect(showStatusChip(undefined)).toBeNull()
  })
})

describe('tvHrefs and seasonLabel', () => {
  it('keys every level on the encoded originalTitle', () => {
    expect(tvHrefs({ originalTitle: 'KINGDOM (2019)', showTitle: 'Kingdom', seasonNumber: 1, episodeNumber: 3 })).toEqual({
      tv: '/list/tv',
      show: '/list/tv/KINGDOM%20(2019)',
      season: '/list/tv/KINGDOM%20(2019)/1',
      episode: '/list/tv/KINGDOM%20(2019)/1/3',
      play: '/list/tv/KINGDOM%20(2019)/1/3/play',
    })
  })

  it('falls back to the show title, encodes a percent sign and keeps season 0', () => {
    expect(tvHrefs({ showTitle: '100% Wolf', seasonNumber: 0 })).toEqual({
      tv: '/list/tv',
      show: '/list/tv/100%25%20Wolf',
      season: '/list/tv/100%25%20Wolf/0',
      episode: null,
      play: null,
    })
    expect(tvHrefs({ originalTitle: 'Preacher', episodeNumber: 2 }).episode).toBeNull()
    expect(tvHrefs({ originalTitle: 'Preacher' }).play).toBeNull()
  })

  it('names season 0 Specials', () => {
    expect(seasonLabel(0)).toBe('Specials')
    expect(seasonLabel(3)).toBe('Season 3')
  })
})

describe('mergeSeasons', () => {
  it('unions TMDB and library seasons, dropping Specials the library lacks', () => {
    const tiles = mergeSeasons(preacher, episodes)
    expect(tiles.map((t) => t.seasonNumber)).toEqual([1, 2, 3, 4])
    expect(tiles[0]).toEqual({
      seasonNumber: 1,
      title: 'Season 1',
      available: true,
      href: '/list/tv/Preacher/1',
      posterURL: 'https://cdn.example/tv/Preacher/s1.jpg',
      posterBlurhash: 'S1BLUR',
      year: '2016',
      episodeCount: 10,
      tmdbEpisodeCount: 10,
    })
    // The live episode list beats FlatSeasons.episodeCount, and the TMDB poster carries no blurhash
    expect(tiles[1]).toEqual({
      seasonNumber: 2,
      title: 'Season 2',
      available: true,
      href: '/list/tv/Preacher/2',
      posterURL: 'https://image.tmdb.org/t/p/w342/s2lib.jpg',
      posterBlurhash: null,
      year: '2017',
      episodeCount: 3,
      tmdbEpisodeCount: 13,
    })
    // Not in the library: a dashed placeholder, no poster, no link
    expect(tiles[2]).toEqual({
      seasonNumber: 3,
      title: 'Season 3',
      available: false,
      href: null,
      posterURL: null,
      posterBlurhash: null,
      year: '2018',
      episodeCount: null,
      tmdbEpisodeCount: 10,
    })
    // In the library, but with no visible episode: also unavailable
    expect(tiles[3]).toMatchObject({ seasonNumber: 4, available: false, href: null, posterURL: null, episodeCount: null, year: '2019' })
  })

  it('trusts the library when the episode list is unknown, using TMDB then the show poster', () => {
    const tiles = mergeSeasons(preacher, [])
    expect(tiles[3]).toEqual({
      seasonNumber: 4,
      title: 'Season 4',
      available: true,
      href: '/list/tv/Preacher/4',
      posterURL: 'https://image.tmdb.org/t/p/w342/s4tmdb.jpg',
      posterBlurhash: null,
      year: '2019',
      episodeCount: 10,
      tmdbEpisodeCount: 10,
    })

    // No poster anywhere but the show's: the show poster with its own blurhash
    const bare = {
      title: 'Kingdom',
      originalTitle: 'KINGDOM (2019)',
      posterURL: 'https://cdn.example/tv/KINGDOM (2019)/poster.jpg',
      posterBlurhash: 'KBLUR',
      seasons: [{ _id: 'k1', seasonNumber: 1, episodeCount: 6 }],
    }
    expect(mergeSeasons(bare)).toEqual([
      {
        seasonNumber: 1,
        title: 'Season 1',
        available: true,
        href: '/list/tv/KINGDOM%20(2019)/1',
        posterURL: 'https://cdn.example/tv/KINGDOM (2019)/poster.jpg',
        posterBlurhash: 'KBLUR',
        year: null,
        episodeCount: 6,
        tmdbEpisodeCount: null,
      },
    ])
  })

  it('keeps Specials when the library has them, first in order', () => {
    const withSpecials = {
      ...preacher,
      seasons: [...preacher.seasons, { _id: 's0', seasonNumber: 0, title: 'Specials', episodeCount: 2, posterURL: 'https://cdn.example/s0.jpg' }],
    }
    const tiles = mergeSeasons(withSpecials, [ep(0, 1, 'Behind the scenes'), ...episodes])
    expect(tiles.map((t) => t.seasonNumber)).toEqual([0, 1, 2, 3, 4])
    expect(tiles[0]).toMatchObject({ title: 'Specials', available: true, href: '/list/tv/Preacher/0', episodeCount: 1, year: '2016' })
  })

  it('copes with a show with no seasons at all', () => {
    expect(mergeSeasons({ title: 'Empty', originalTitle: 'Empty' })).toEqual([])
    expect(mergeSeasons(null)).toEqual([])
  })
})

describe('seasonsSummary', () => {
  it('counts available seasons against TMDB, excluding Specials', () => {
    expect(seasonsSummary(preacher, mergeSeasons(preacher, episodes))).toBe('2 of 4 seasons available')
    expect(seasonsSummary(preacher, mergeSeasons(preacher, []))).toBe('3 of 4 seasons available')
    const tiles = [
      { seasonNumber: 0, available: true },
      { seasonNumber: 1, available: true },
      { seasonNumber: 2, available: true },
      { seasonNumber: 3, available: true },
    ]
    expect(seasonsSummary({ metadata: { number_of_seasons: 2 } }, tiles)).toBe('3 of 3 seasons available')
  })

  it('falls back to a plain count when TMDB has no season count', () => {
    const tiles = [
      { seasonNumber: 1, available: true },
      { seasonNumber: 2, available: false },
    ]
    expect(seasonsSummary({ metadata: {} }, tiles)).toBe('1 season')
    expect(seasonsSummary({}, [{ seasonNumber: 0, available: true }, ...tiles])).toBe('2 seasons')
    expect(seasonsSummary(null, [])).toBe('0 seasons')
  })
})

describe('pickNextUp', () => {
  it('resumes the most recently watched episode under way, as the same object', () => {
    const next = pickNextUp(episodes)
    expect(next.kind).toBe('resume')
    expect(next.episode).toBe(episodes[0])
  })

  it('resumes the most recent of several in-progress episodes, earliest on a tie', () => {
    const list = [
      ep(1, 1, 'Pilot', inProgress(509, '2026-09-01T00:00:00.000Z')),
      ep(1, 2, 'See', inProgress(120, '2026-09-05T00:00:00.000Z')),
      ep(2, 1, 'On the Road', inProgress(60, '2026-09-05T00:00:00.000Z')),
    ]
    expect(pickNextUp(list)).toEqual({ episode: list[1], kind: 'resume' })
    // Unsorted input is put in order first
    expect(pickNextUp([list[2], list[1], list[0]]).episode).toBe(list[1])
  })

  it('starts at the first regular episode when nothing was watched', () => {
    const list = [ep(0, 1, 'Special'), ep(1, 2, 'See'), ep(1, 1, 'Pilot')]
    expect(pickNextUp(list)).toEqual({ episode: list[2], kind: 'start' })
    const onlySpecials = [ep(0, 2, 'B'), ep(0, 1, 'A')]
    expect(pickNextUp(onlySpecials)).toEqual({ episode: onlySpecials[1], kind: 'start' })
  })

  it('plays the episode after the most recently finished one', () => {
    const list = [
      ep(1, 1, 'Pilot', done('2026-08-01T00:00:00.000Z')),
      ep(1, 2, 'See', done('2026-08-03T00:00:00.000Z')),
      ep(1, 3, 'The Possibilities', done('2026-08-02T00:00:00.000Z')),
      ep(1, 4, 'Monster Swamp'),
      ep(1, 5, 'South Will Rise Again'),
    ]
    expect(pickNextUp(list)).toEqual({ episode: list[3], kind: 'next' })
  })

  it('crosses into the next season and wraps to the first unwatched episode', () => {
    const acrossSeasons = [ep(1, 1, 'Pilot', done('2026-08-01T00:00:00.000Z')), ep(1, 2, 'See', done('2026-08-02T00:00:00.000Z')), ep(2, 1, 'On the Road')]
    expect(pickNextUp(acrossSeasons)).toEqual({ episode: acrossSeasons[2], kind: 'next' })

    const wrapped = [ep(1, 1, 'Pilot'), ep(1, 2, 'See', done('2026-08-02T00:00:00.000Z')), ep(2, 1, 'On the Road', done('2026-08-09T00:00:00.000Z'))]
    expect(pickNextUp(wrapped)).toEqual({ episode: wrapped[0], kind: 'next' })
  })

  it('offers a rewatch from the first regular episode once everything is finished', () => {
    const list = [ep(0, 1, 'Special', done('2026-08-05T00:00:00.000Z')), ep(1, 2, 'See', done('2026-08-02T00:00:00.000Z')), ep(1, 1, 'Pilot', done('2026-08-01T00:00:00.000Z'))]
    expect(pickNextUp(list)).toEqual({ episode: list[2], kind: 'rewatch' })
  })

  it('treats a completed row as finished even when its position is high, and an empty list as nothing', () => {
    const list = [ep(1, 1, 'Pilot', { playbackTime: 3800, completed: true, progressPercent: 98.9, lastWatched: '2026-08-01T00:00:00.000Z' }), ep(1, 2, 'See')]
    expect(pickNextUp(list)).toEqual({ episode: list[1], kind: 'next' })
    expect(pickNextUp([])).toBeNull()
    expect(pickNextUp(undefined)).toBeNull()
  })
})

describe('nextUpNoun and nextUpLine', () => {
  it('names the episode for the button, per page', () => {
    const next = pickNextUp(episodes)
    expect(nextUpNoun(next, 'show')).toBe('S1 · E1')
    expect(nextUpNoun(next, 'season')).toBe('Episode 1')
    expect(nextUpNoun({ episode: ep(0, 3, 'Special'), kind: 'start' }, 'show')).toBe('Specials · E3')
    expect(nextUpNoun({ episode: ep(0, 3, 'Special'), kind: 'start' }, 'season')).toBe('Episode 3')
    expect(nextUpNoun(null, 'show')).toBeNull()
  })

  it('reads the position and what is left for an episode under way', () => {
    const next = pickNextUp(episodes)
    const progress = readProgress({ watchHistory: next.episode.watchHistory, durationMs: DURATION_MS })
    expect(nextUpLine({ nextUp: next, progress, totalEpisodes: episodes.length })).toBe('Pilot · 8:29 watched · 56m left')
    // Runtime unknown: no remaining time
    const noRuntime = readProgress({ watchHistory: next.episode.watchHistory, durationMs: null })
    expect(nextUpLine({ nextUp: next, progress: noRuntime, totalEpisodes: 13 })).toBe('Pilot · 8:29 watched')
  })

  it('stays coherent with a client-side Watch again, and sums up a finished show', () => {
    const next = pickNextUp(episodes)
    const finished = readProgress({ watchHistory: { playbackTime: 3800, completed: true, progressPercent: 98.9 }, durationMs: DURATION_MS })
    expect(nextUpLine({ nextUp: next, progress: finished, totalEpisodes: 13 })).toBe('Pilot · Watched')
    expect(nextUpLine({ nextUp: { episode: episodes[0], kind: 'rewatch' }, progress: finished, totalEpisodes: 43 })).toBe('All 43 episodes watched')
  })

  it('falls back to the title, the episode number or Not started', () => {
    const fresh = readProgress({ watchHistory: UNWATCHED, durationMs: DURATION_MS })
    expect(nextUpLine({ nextUp: { episode: ep(1, 1, 'Pilot'), kind: 'start' }, progress: fresh, totalEpisodes: 10 })).toBe('Pilot')
    expect(nextUpLine({ nextUp: { episode: ep(1, 1, null), kind: 'start' }, progress: fresh, totalEpisodes: 10 })).toBe('Not started')
    expect(nextUpLine({ nextUp: { episode: ep(1, 4, null), kind: 'next' }, progress: fresh, totalEpisodes: 10 })).toBe('Episode 4')
    expect(nextUpLine({ nextUp: { episode: { ...ep(1, 2, null), metadata: { name: 'See' } }, kind: 'next' }, progress: null, totalEpisodes: 10 })).toBe('See')
    expect(nextUpLine({ nextUp: null, progress: fresh, totalEpisodes: 10 })).toBeNull()
  })
})

describe('seasonTileStatus', () => {
  const nextUp = pickNextUp(episodes)

  it('points at the next-up episode, marks finished seasons and empty ones', () => {
    expect(seasonTileStatus({ seasonNumber: 1, episodes, nextUp })).toEqual({ kind: 'continue', label: 'Continue Episode 1' })
    expect(seasonTileStatus({ seasonNumber: 2, episodes, nextUp })).toEqual({ kind: 'watched', label: 'Watched' })
    expect(seasonTileStatus({ seasonNumber: 4, episodes, nextUp })).toEqual({ kind: 'unavailable', label: null })
  })

  it('reports partial progress and untouched seasons', () => {
    const list = [ep(1, 1, 'Pilot', done('2026-08-01T00:00:00.000Z')), ep(1, 2, 'See'), ep(1, 3, 'The Possibilities'), ep(2, 1, 'On the Road')]
    // The next-up episode lives in season 1, so season 1 says Continue…
    expect(seasonTileStatus({ seasonNumber: 1, episodes: list, nextUp: pickNextUp(list) })).toEqual({ kind: 'continue', label: 'Continue Episode 2' })
    // …and without it the same season reads as partly watched
    expect(seasonTileStatus({ seasonNumber: 1, episodes: list, nextUp: null })).toEqual({ kind: 'partial', label: '1 of 3 watched' })
    expect(seasonTileStatus({ seasonNumber: 2, episodes: list, nextUp: pickNextUp(list) })).toEqual({ kind: 'unwatched', label: 'Not started' })
    // A position without a completion still counts as started
    const started = [ep(1, 1, 'Pilot', inProgress(30, null)), ep(1, 2, 'See')]
    expect(seasonTileStatus({ seasonNumber: 1, episodes: started, nextUp: { episode: started[0], kind: 'rewatch' } })).toEqual({ kind: 'partial', label: '0 of 2 watched' })
  })
})

describe('seasonQuality and episodeRowChips', () => {
  it('takes the best resolution and every HDR format, never SDR', () => {
    expect(seasonQuality(episodes)).toEqual({ resolution: '1080p', hdr: [], chips: ['1080p'] })
    const mixed = [
      { dimensions: '1280x720', hdr: '8-bit SDR (BT.709)' },
      { dimensions: '1920x1080', hdr: 'HDR10' },
      { dimensions: '3840x2160', hdr: 'Dolby Vision', mediaQuality: { viewingExperience: { dolbyVision: true, standardHDR: true } } },
      { dimensions: '3840x2160', hdr: 'HDR10' },
    ]
    expect(seasonQuality(mixed)).toEqual({ resolution: '4K', hdr: ['HDR10', 'Dolby Vision'], chips: ['4K', 'HDR10', 'Dolby Vision'] })
    expect(seasonQuality([{ dimensions: '720x576' }])).toEqual({ resolution: 'SD', hdr: [], chips: [] })
    expect(seasonQuality([{}])).toEqual({ resolution: null, hdr: [], chips: [] })
    expect(seasonQuality([])).toEqual({ resolution: null, hdr: [], chips: [] })
  })

  it('chips a row with its quality and CC when a subtitle track is ready', () => {
    const withSubs = { ...episodes[0], captionURLs: { English: { srcLang: 'en', url: 'https://x/en.vtt' } } }
    expect(episodeRowChips(withSubs)).toEqual(['1080p', 'CC'])
    const pendingOnly = { ...episodes[0], captionURLs: { 'English - Auto Generated': { autoGenerated: true, pending: true } } }
    expect(episodeRowChips(pendingOnly)).toEqual(['1080p'])
    expect(episodeRowChips({ dimensions: '3840x2160', hdr: 'HDR10' })).toEqual(['4K', 'HDR10'])
    expect(episodeRowChips({})).toEqual([])
  })
})

describe('tvLinks and showFacts', () => {
  it('links TMDB and an absolute homepage only', () => {
    expect(tvLinks(preacher.metadata)).toEqual([
      { label: 'TMDB', href: 'https://www.themoviedb.org/tv/62741' },
      { label: 'Official site', href: 'http://www.amc.com/shows/preacher' },
    ])
    expect(tvLinks({ id: 'abc', homepage: 'www.example.com' })).toEqual([])
    expect(tvLinks({ id: '77', homepage: '' })).toEqual([{ label: 'TMDB', href: 'https://www.themoviedb.org/tv/77' }])
    expect(tvLinks(null)).toEqual([])
  })

  it('lists the show facts in order, with the library count when it differs', () => {
    const rows = showFacts(preacher, { libraryEpisodeCount: 13 })
    expect(rows).toEqual([
      { label: 'Created by', value: 'Sam Catlin, Evan Goldberg, Seth Rogen' },
      { label: 'Network', value: 'AMC' },
      { label: 'Language', value: 'English' },
      { label: 'Country', value: 'United States of America' },
      { label: 'First aired', value: 'May 22, 2016' },
      { label: 'Last aired', value: 'Sep 29, 2019' },
      { label: 'Episodes', value: '43 · 13 in your library' },
      { label: 'TMDB score', value: '7.7 / 10 · 1,289 votes' },
      {
        label: 'Links',
        value: 'TMDB, Official site',
        links: [
          { label: 'TMDB', href: 'https://www.themoviedb.org/tv/62741' },
          { label: 'Official site', href: 'http://www.amc.com/shows/preacher' },
        ],
      },
    ])
    expect(rows.find((r) => r.label === 'Type')).toBeUndefined()
  })

  it('leaves out what it does not know and reads the counts from the document', () => {
    const rows = showFacts({
      visibleEpisodeCount: 43,
      metadata: {
        networks: [{ name: 'HBO' }, { name: 'Sky Atlantic' }],
        origin_country: ['gb', 'us'],
        first_air_date: '2011-04-17',
        last_air_date: '2011-04-17',
        number_of_episodes: 43,
        vote_average: 8.4,
        vote_count: 0,
        created_by: [{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }, { name: 'E' }],
      },
    })
    expect(rows).toEqual([
      { label: 'Created by', value: 'A, B, C, D' },
      { label: 'Networks', value: 'HBO, Sky Atlantic' },
      { label: 'Country', value: 'GB, US' },
      { label: 'First aired', value: 'Apr 17, 2011' },
      { label: 'Episodes', value: '43' },
      { label: 'TMDB score', value: '8.4 / 10' },
    ])
    expect(showFacts({ visibleEpisodeCount: 7, metadata: {} })).toEqual([{ label: 'Episodes', value: '7 in your library' }])
    expect(showFacts({ metadata: {} })).toEqual([])
    expect(showFacts(null)).toEqual([])
  })
})

describe('seasonFacts', () => {
  it('shows the air date and score, and the episode count only on a mismatch', () => {
    const s1 = { ...preacher.seasons[0], episodes: episodes.filter((e) => e.seasonNumber === 1) }
    expect(seasonFacts(s1)).toEqual([
      { label: 'Aired', value: 'May 22, 2016' },
      { label: 'TMDB score', value: '7.6 / 10' },
    ])
    const s2 = { ...preacher.seasons[1], episodes: episodes.filter((e) => e.seasonNumber === 2) }
    expect(seasonFacts(s2)).toEqual([
      { label: 'Aired', value: 'Jun 25, 2017' },
      { label: 'Episodes', value: '13 · 3 in your library' },
      { label: 'TMDB score', value: '7.4 / 10' },
    ])
  })

  it('falls back to the season rating and copes with an empty season', () => {
    expect(seasonFacts({ seasonNumber: 3, rating: 6.95 })).toEqual([{ label: 'TMDB score', value: '7.0 / 10' }])
    expect(seasonFacts({ seasonNumber: 3, metadata: { vote_average: 0 } })).toEqual([])
    expect(seasonFacts(null)).toEqual([])
  })
})

describe('blurDataURL', () => {
  const { blurDataURL } = require('@src/utils/media/tvFacts')

  it('wraps a stored base64 blurhash and passes a data URL through', () => {
    expect(blurDataURL('iVBORw0KGgo')).toBe('data:image/png;base64,iVBORw0KGgo')
    expect(blurDataURL('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA')
    expect(blurDataURL('')).toBeNull()
    expect(blurDataURL(null)).toBeNull()
  })
})
