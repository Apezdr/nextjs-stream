/**
 * Pure helpers behind the TV info pages (show, season, episode): the show's
 * display name and eyebrow, the meta line, the seasons grid, the "next up"
 * episode and its one-line status, the season's quality chips, and the
 * facts panels. No React and no I/O so every rule is unit tested against
 * the shapes the flat documents actually carry.
 *
 * Inputs:
 *  - a show as `getFlatRequestedMedia({ type: 'tv', title })` returns it
 *    (`title`, `originalTitle`, `metadata` from TMDB, `seasons[]` = the
 *    library's FlatSeasons docs) — or the lighter `showSummary` a season
 *    payload carries;
 *  - episodes as `getFlatShowEpisodesForProgress` returns them, each with
 *    the `watchHistory` object the server joins (`playbackTime`,
 *    `progressPercent`, `completed`, `lastWatched`);
 *  - a `progress` reading from `readProgress` / `useLiveProgress`.
 *
 * Route hrefs key on `originalTitle` (the filesystem key); everything a
 * viewer reads uses the display title. Nothing here names a server.
 */

import { yearOf, formatDate, languageName, resolutionLabel, qualityChips, subtitleSummary } from './detailsFacts'
import { formatClock, formatRemaining } from '@components/WatchProgress/progress'
import { getFullImageUrl } from '@src/utils'

const trimmed = (value) => (typeof value === 'string' ? value.trim() : '')

const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value)

/**
 * The name to show for a series. A library synced from folder names leaves
 * `title` equal to the filesystem `originalTitle` ("KINGDOM (2019)"); TMDB's
 * own `name` restores the pretty form. A `title` that differs from the
 * folder name was set on purpose and wins.
 *
 * Works for a show document (`metadata.name`) and for the `showSummary` a
 * season payload carries (`name`).
 *
 * @param {{ title?: string|null, originalTitle?: string|null, name?: string|null, metadata?: { name?: string|null }|null }|null|undefined} show
 * @returns {string}
 */
export function showTitleOf(show) {
  const t = trimmed(show?.title)
  const n = trimmed(show?.name ?? show?.metadata?.name ?? '')
  if (t && t !== show?.originalTitle) return t
  return n || t || trimmed(show?.originalTitle)
}

/**
 * TMDB's `type` the way a viewer says it: "Scripted" is just a series.
 *
 * @param {{ type?: string|null }|null|undefined} metadata
 * @returns {string|null}
 */
export function showTypeLabel(metadata) {
  const type = trimmed(metadata?.type)
  if (!type) return null
  if (type === 'Scripted') return 'Series'
  if (type === 'Miniseries') return 'Miniseries'
  return type
}

/**
 * The eyebrow above the show title: first network, then the type — the
 * CSS upper-cases it into "AMC · SERIES".
 *
 * @param {{ metadata?: Object|null }|null|undefined} show
 * @returns {string|null}
 */
export function showEyebrow(show) {
  const network = trimmed(show?.metadata?.networks?.[0]?.name)
  const parts = [network, showTypeLabel(show?.metadata)].filter(Boolean)
  return parts.length ? parts.join(' · ') : null
}

/**
 * "2016–2019", "2016–" for a show still running, or "2016" for a single
 * year. Null without a first air date.
 *
 * @param {{ first_air_date?: string|null, last_air_date?: string|null, status?: string|null, in_production?: boolean|null }|null|undefined} metadata
 * @returns {string|null}
 */
export function showYears(metadata) {
  const first = yearOf(metadata?.first_air_date)
  if (!first) return null
  const last = yearOf(metadata?.last_air_date)
  const status = trimmed(metadata?.status).toLowerCase()
  const running = status === 'returning series' || status === 'in production' || metadata?.in_production === true
  if (running) return `${first}–`
  if (last && last !== first) return `${first}–${last}`
  return first
}

/**
 * TMDB's status as a short title-case chip, or null when unknown.
 *
 * @param {{ status?: string|null }|null|undefined} metadata
 * @returns {string|null}
 */
export function showStatusChip(metadata) {
  const status = trimmed(metadata?.status)
  if (!status) return null
  switch (status) {
    case 'Ended':
      return 'Ended'
    case 'Returning Series':
      return 'Returning'
    case 'Canceled':
    case 'Cancelled':
      return 'Canceled'
    case 'In Production':
      return 'In production'
    case 'Planned':
      return 'Planned'
    case 'Pilot':
      return 'Pilot'
    default:
      return status
  }
}

/**
 * Every href under a show, keyed on the filesystem `originalTitle` the way
 * the routes resolve it. Levels that need a number they were not given
 * come back null.
 *
 * @param {{ originalTitle?: string|null, showTitle?: string|null, seasonNumber?: number|null, episodeNumber?: number|null }} keys
 * @returns {{ tv: string, show: string, season: string|null, episode: string|null, play: string|null }}
 */
export function tvHrefs({ originalTitle, showTitle, seasonNumber, episodeNumber } = {}) {
  const routeKey = encodeURIComponent(originalTitle || showTitle || '')
  const show = `/list/tv/${routeKey}`
  const season = seasonNumber != null ? `${show}/${seasonNumber}` : null
  const episode = season && episodeNumber != null ? `${season}/${episodeNumber}` : null
  const play = episode ? `${episode}/play` : null
  return { tv: '/list/tv', show, season, episode, play }
}

/**
 * "Season 3", or "Specials" for TMDB's season 0.
 *
 * @param {number} seasonNumber
 * @returns {string}
 */
export function seasonLabel(seasonNumber) {
  return seasonNumber === 0 ? 'Specials' : `Season ${seasonNumber}`
}

/**
 * The TMDB image URL for a poster path, or null.
 */
function tmdbPoster(path) {
  return typeof path === 'string' && path ? getFullImageUrl(path, 'w342') : null
}

/**
 * @typedef {Object} SeasonTileData
 * @property {number} seasonNumber
 * @property {string} title
 * @property {boolean} available - in the library, with a visible episode when the list is known
 * @property {string|null} href - the season page, when available
 * @property {string|null} posterURL
 * @property {string|null} posterBlurhash - raw base64; the tile builds the data URL
 * @property {string|null} year
 * @property {number|null} episodeCount - episodes in the library (available seasons only)
 * @property {number|null} tmdbEpisodeCount
 */

/**
 * The seasons grid: TMDB's season list ∪ the library's, one tile per
 * number in ascending order. TMDB's "Specials" (season 0) only appears
 * when the library has it. A season is available when the library has a
 * doc for it and — when the caller knows the episode list — at least one
 * visible episode belongs to it; `FlatSeasons.episodeCount` can count
 * hidden files, so the live list wins for the count too.
 *
 * Available seasons get a poster (their own, then TMDB's season poster,
 * then the show poster, each with the matching blurhash); missing seasons
 * deliberately get none — the tile draws a dashed placeholder.
 *
 * @param {Object} show - show document (`metadata.seasons`, `seasons`, `posterURL`, `posterBlurhash`, `originalTitle`, `title`)
 * @param {Array<{ seasonNumber: number }>} [episodes] - the show's visible episodes, when known
 * @returns {SeasonTileData[]}
 */
export function mergeSeasons(show, episodes = []) {
  const list = Array.isArray(episodes) ? episodes : []
  const librarySeasons = new Map()
  for (const season of Array.isArray(show?.seasons) ? show.seasons : []) {
    if (isFiniteNumber(season?.seasonNumber) && !librarySeasons.has(season.seasonNumber)) {
      librarySeasons.set(season.seasonNumber, season)
    }
  }
  const tmdbSeasons = new Map()
  for (const season of Array.isArray(show?.metadata?.seasons) ? show.metadata.seasons : []) {
    const n = season?.season_number
    if (!isFiniteNumber(n) || tmdbSeasons.has(n)) continue
    if (n === 0 && !librarySeasons.has(0)) continue
    tmdbSeasons.set(n, season)
  }

  const numbers = [...new Set([...tmdbSeasons.keys(), ...librarySeasons.keys()])].sort((a, b) => a - b)
  const countBySeason = new Map()
  for (const ep of list) {
    if (!isFiniteNumber(ep?.seasonNumber)) continue
    countBySeason.set(ep.seasonNumber, (countBySeason.get(ep.seasonNumber) || 0) + 1)
  }

  return numbers.map((n) => {
    const season = librarySeasons.get(n) || null
    const tmdb = tmdbSeasons.get(n) || null
    const inLibrary = Boolean(season)
    const available = inLibrary && (list.length > 0 ? countBySeason.has(n) : true)

    let posterURL = null
    let posterBlurhash = null
    if (available) {
      if (season.posterURL) {
        posterURL = season.posterURL
        posterBlurhash = season.posterBlurhash || null
      } else {
        const fromTmdb = tmdbPoster(season.metadata?.poster_path || tmdb?.poster_path)
        if (fromTmdb) {
          posterURL = fromTmdb
        } else if (show?.posterURL) {
          posterURL = show.posterURL
          posterBlurhash = show.posterBlurhash || null
        }
      }
    }

    let episodeCount = null
    if (available) {
      if (list.length > 0) episodeCount = countBySeason.get(n) ?? null
      else episodeCount = isFiniteNumber(season.episodeCount) ? season.episodeCount : null
    }
    const tmdbCount = tmdb?.episode_count ?? season?.metadata?.episode_count
    const tmdbEpisodeCount = isFiniteNumber(tmdbCount) ? tmdbCount : null

    return {
      seasonNumber: n,
      title: trimmed(season?.title) || trimmed(tmdb?.name) || seasonLabel(n),
      available,
      href: available ? tvHrefs({ originalTitle: show?.originalTitle, showTitle: show?.title, seasonNumber: n }).season : null,
      posterURL,
      posterBlurhash,
      year: yearOf(season?.airDate || season?.metadata?.air_date || tmdb?.air_date),
      episodeCount,
      tmdbEpisodeCount,
    }
  })
}

/**
 * "3 of 4 seasons available" against TMDB's season count (specials
 * excluded, as TMDB excludes them), or "3 seasons" when TMDB has no count.
 *
 * @param {{ metadata?: { number_of_seasons?: number|null }|null }|null|undefined} show
 * @param {SeasonTileData[]} tiles
 * @returns {string}
 */
export function seasonsSummary(show, tiles) {
  const list = Array.isArray(tiles) ? tiles : []
  const available = list.filter((t) => t.available && t.seasonNumber !== 0).length
  const total = Number(show?.metadata?.number_of_seasons)
  if (Number.isInteger(total) && total > 0) {
    return `${available} of ${Math.max(total, available)} seasons available`
  }
  const n = list.filter((t) => t.available).length
  return `${n} season${n === 1 ? '' : 's'}`
}

/**
 * The status line under a season tile, from that season's episodes and
 * the show's next-up episode.
 *
 * @param {{ seasonNumber: number, episodes: Array<{ seasonNumber: number, watchHistory?: Object|null }>, nextUp: NextUp|null }} input
 * @returns {{ kind: 'continue'|'watched'|'partial'|'unwatched'|'unavailable', label: string|null }}
 */
export function seasonTileStatus({ seasonNumber, episodes, nextUp }) {
  const eps = (Array.isArray(episodes) ? episodes : []).filter((e) => e?.seasonNumber === seasonNumber)
  if (eps.length === 0) return { kind: 'unavailable', label: null }
  if (nextUp && (nextUp.kind === 'resume' || nextUp.kind === 'next') && nextUp.episode?.seasonNumber === seasonNumber) {
    return { kind: 'continue', label: `Continue Episode ${nextUp.episode.episodeNumber}` }
  }
  const completedCount = eps.filter((e) => e.watchHistory?.completed === true).length
  if (completedCount === eps.length) return { kind: 'watched', label: 'Watched' }
  const started = eps.some((e) => (e.watchHistory?.playbackTime ?? 0) > 0)
  if (completedCount > 0 || started) return { kind: 'partial', label: `${completedCount} of ${eps.length} watched` }
  return { kind: 'unwatched', label: 'Not started' }
}

/**
 * @typedef {{ episode: Object, kind: 'start'|'resume'|'next'|'rewatch' }} NextUp
 */

const byOrder = (a, b) => a.seasonNumber - b.seasonNumber || a.episodeNumber - b.episodeNumber

const lastWatchedAt = (e) => Number(new Date(e.watchHistory?.lastWatched || 0)) || 0

/** The entry with the greatest timestamp; ties keep the earliest in order. */
function mostRecent(eps) {
  let best = null
  let bestTs = -1
  for (const e of eps) {
    const ts = lastWatchedAt(e)
    if (ts > bestTs) {
      best = e
      bestTs = ts
    }
  }
  return best
}

/** The first regular episode; the first special only when that is all there is. */
const firstRegular = (order) => order.find((e) => e.seasonNumber !== 0) || order[0]

/**
 * Which episode the viewer should play next, and why.
 *
 *   resume  — the most recently watched episode that is under way
 *   next    — the first unwatched episode after the most recently finished one
 *             (wrapping to the first unwatched anywhere)
 *   rewatch — everything is finished: the first regular episode again
 *   start   — nothing watched: the first regular episode
 *
 * Pure. The returned `episode` is the caller's own object, so what was
 * joined onto it (watch history, hrefs) travels with it.
 *
 * @param {Array<Object>} episodes - with `seasonNumber`, `episodeNumber` and `watchHistory`
 * @returns {NextUp|null}
 */
export function pickNextUp(episodes) {
  const order = (Array.isArray(episodes) ? episodes : []).filter(Boolean).slice().sort(byOrder)
  if (order.length === 0) return null

  const inProgress = order.filter((e) => {
    const h = e.watchHistory
    return ((h?.playbackTime ?? 0) > 0 || (h?.progressPercent ?? 0) > 0) && !h?.completed
  })
  if (inProgress.length > 0) return { episode: mostRecent(inProgress), kind: 'resume' }

  const completed = order.filter((e) => e.watchHistory?.completed === true)
  if (completed.length > 0) {
    const recent = mostRecent(completed)
    const after = order.indexOf(recent) + 1
    const candidate =
      order.slice(after).find((e) => !e.watchHistory?.completed) || order.find((e) => !e.watchHistory?.completed) || null
    if (candidate) return { episode: candidate, kind: 'next' }
    return { episode: firstRegular(order), kind: 'rewatch' }
  }

  return { episode: firstRegular(order), kind: 'start' }
}

/**
 * The noun after the play verb: "S1 · E1" on the show page, "Episode 1"
 * on a season page. The button prepends Play / Resume / Watch again.
 *
 * @param {NextUp|null} nextUp
 * @param {'show'|'season'} scope
 * @returns {string|null}
 */
export function nextUpNoun(nextUp, scope) {
  const ep = nextUp?.episode
  if (!ep) return null
  if (scope === 'season') return `Episode ${ep.episodeNumber}`
  return ep.seasonNumber === 0 ? `Specials · E${ep.episodeNumber}` : `S${ep.seasonNumber} · E${ep.episodeNumber}`
}

/**
 * The line under the show's actions: "Pilot · 8:29 watched · 56m left",
 * "Pilot · Watched", "All 43 episodes watched", or just the title.
 *
 * @param {{ nextUp: NextUp|null, progress: { completed?: boolean, hasProgress?: boolean, playbackTime?: number, remainingSeconds?: number|null }|null|undefined, totalEpisodes: number }} input
 * @returns {string|null}
 */
export function nextUpLine({ nextUp, progress, totalEpisodes }) {
  if (!nextUp?.episode) return null
  if (nextUp.kind === 'rewatch') return `All ${totalEpisodes} episodes watched`
  const ep = nextUp.episode
  const named = trimmed(ep.title) || trimmed(ep.metadata?.name) || null
  const title = named || `Episode ${ep.episodeNumber}`
  if (progress?.completed) return `${title} · Watched`
  if (progress?.hasProgress) {
    const remaining = progress.remainingSeconds != null ? ` · ${formatRemaining(progress.remainingSeconds)}` : ''
    return `${title} · ${formatClock(progress.playbackTime)} watched${remaining}`
  }
  if (nextUp.kind === 'start' && !named) return 'Not started'
  return title
}

const RESOLUTION_RANK = { '4K': 4, '1080p': 3, '720p': 2, SD: 1 }

/**
 * A season's quality at a glance: its best resolution and every dynamic
 * range its episodes carry (SDR is the norm and stays silent).
 *
 * @param {Array<{ dimensions?: string|null, hdr?: string|null, mediaQuality?: Object|null }>} episodes
 * @returns {{ resolution: string|null, hdr: string[], chips: string[] }}
 */
export function seasonQuality(episodes) {
  const list = Array.isArray(episodes) ? episodes : []
  let resolution = null
  const hdr = []
  for (const ep of list) {
    const label = resolutionLabel(ep?.dimensions)
    if (label && (RESOLUTION_RANK[label] || 0) > (RESOLUTION_RANK[resolution] || 0)) resolution = label
    for (const chip of qualityChips(ep)) {
      if (RESOLUTION_RANK[chip] || chip === 'SDR' || hdr.includes(chip)) continue
      hdr.push(chip)
    }
  }
  const chips = (resolution && resolution !== 'SD' ? [resolution] : []).concat(hdr)
  return { resolution, hdr, chips }
}

/**
 * The chips on an episode row: resolution and HDR (never SDR), then "CC"
 * when a subtitle track is ready.
 *
 * @param {Object} episode
 * @returns {string[]}
 */
export function episodeRowChips(episode) {
  const chips = qualityChips(episode).filter((c) => c !== 'SDR')
  if (subtitleSummary(episode?.captionURLs).ready.length > 0) chips.push('CC')
  return chips
}

/**
 * Where else to read about a show: TMDB and the official site.
 *
 * @param {{ id?: number|string|null, homepage?: string|null }|null|undefined} metadata
 * @returns {Array<{ label: string, href: string }>}
 */
export function tvLinks(metadata) {
  const links = []
  const tmdbId = Number(metadata?.id)
  if (Number.isInteger(tmdbId) && tmdbId > 0) links.push({ label: 'TMDB', href: `https://www.themoviedb.org/tv/${tmdbId}` })
  const home = trimmed(metadata?.homepage)
  if (/^https?:\/\//i.test(home)) links.push({ label: 'Official site', href: home })
  return links
}

/**
 * The show details panel: creators, networks, language, country, air
 * dates, episode counts, score and links — each only when known. The type
 * is on the eyebrow, so there is no "Type" row.
 *
 * @param {Object} show - show document
 * @param {{ libraryEpisodeCount?: number|null }} [options] - visible episodes in the library, when the caller counted them
 * @returns {Array<{ label: string, value: string|string[], note?: string, links?: Array<{ label: string, href: string, external?: boolean }> }>}
 */
export function showFacts(show, { libraryEpisodeCount = null } = {}) {
  const meta = show?.metadata || {}
  const rows = []

  const creators = (Array.isArray(meta.created_by) ? meta.created_by : []).map((c) => trimmed(c?.name)).filter(Boolean)
  if (creators.length) rows.push({ label: 'Created by', value: creators.slice(0, 4).join(', ') })

  const networks = (Array.isArray(meta.networks) ? meta.networks : []).map((n) => trimmed(n?.name)).filter(Boolean)
  if (networks.length) rows.push({ label: networks.length > 1 ? 'Networks' : 'Network', value: networks.join(', ') })

  const language = languageName(meta.original_language)
  if (language) rows.push({ label: 'Language', value: language })

  const countries = (Array.isArray(meta.production_countries) ? meta.production_countries : []).map((c) => trimmed(c?.name)).filter(Boolean)
  const origins = (Array.isArray(meta.origin_country) ? meta.origin_country : []).map((c) => trimmed(c).toUpperCase()).filter(Boolean)
  if (countries.length) rows.push({ label: 'Country', value: countries.slice(0, 3).join(', ') })
  else if (origins.length) rows.push({ label: 'Country', value: origins.join(', ') })

  const first = formatDate(meta.first_air_date)
  if (first) rows.push({ label: 'First aired', value: first })
  const last = formatDate(meta.last_air_date)
  if (last && last !== first) rows.push({ label: 'Last aired', value: last })

  const total = isFiniteNumber(meta.number_of_episodes) && meta.number_of_episodes > 0 ? meta.number_of_episodes : null
  const lib = libraryEpisodeCount ?? (isFiniteNumber(show?.visibleEpisodeCount) ? show.visibleEpisodeCount : null)
  if (total) {
    rows.push({ label: 'Episodes', value: lib != null && lib !== total ? `${total} · ${lib} in your library` : `${total}` })
  } else if (lib != null) {
    rows.push({ label: 'Episodes', value: `${lib} in your library` })
  }

  const vote = Number(meta.vote_average)
  if (Number.isFinite(vote) && vote > 0) {
    const votes = Number(meta.vote_count)
    const count = Number.isInteger(votes) && votes > 0 ? `${votes.toLocaleString('en-US')} vote${votes === 1 ? '' : 's'}` : null
    rows.push({ label: 'TMDB score', value: [`${vote.toFixed(1)} / 10`, count].filter(Boolean).join(' · ') })
  }

  const links = tvLinks(meta)
  if (links.length) rows.push({ label: 'Links', value: links.map((l) => l.label).join(', '), links })

  return rows
}

/**
 * The small facts inside a season's "More about this season" disclosure.
 * The episode count only earns a row when TMDB and the library disagree.
 *
 * @param {Object} season - season document (with `episodes[]` when the caller loaded them)
 * @returns {Array<{ label: string, value: string }>}
 */
export function seasonFacts(season) {
  const rows = []
  const aired = formatDate(season?.airDate || season?.metadata?.air_date)
  if (aired) rows.push({ label: 'Aired', value: aired })

  const tmdb = season?.metadata?.episode_count
  const lib = Array.isArray(season?.episodes) ? season.episodes.length : null
  if (isFiniteNumber(tmdb) && lib != null && tmdb !== lib) {
    rows.push({ label: 'Episodes', value: `${tmdb} · ${lib} in your library` })
  }

  const vote = Number(season?.metadata?.vote_average ?? season?.rating)
  if (Number.isFinite(vote) && vote > 0) rows.push({ label: 'TMDB score', value: `${vote.toFixed(1)} / 10` })

  return rows
}

/**
 * A stored blurhash (raw base64 PNG, or already a data URL) as the complete
 * data URL an image placeholder needs, or null.
 *
 * @param {string|null|undefined} value
 * @returns {string|null}
 */
export function blurDataURL(value) {
  if (typeof value !== 'string' || !value.trim()) return null
  const v = value.trim()
  return v.startsWith('data:') ? v : `data:image/png;base64,${v}`
}
