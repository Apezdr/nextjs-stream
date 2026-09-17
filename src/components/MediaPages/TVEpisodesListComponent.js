// Auth (and the unauthenticated fallback) is the route's <AuthGuard>. This
// component renders inside the route's 'use cache' subtree (TVSeasonContent),
// whose cache key includes the viewer id it passes down — the per-viewer
// pieces here (next-up, row progress) are safe only because `userId`
// arrives as a prop from that cached function's argument. Never read the
// session or any other dynamic API here.
import { ViewTransition } from 'react'
import Link from 'next/link'
import { ChevronRightIcon, InformationCircleIcon } from '@heroicons/react/20/solid'
import { getFlatTVSeasonWithEpisodes } from '@src/utils/flatDatabaseUtils'
import { refreshEpisodes } from '@src/utils/actions/refreshEpisodes'
import { isDurableMediaId } from '@src/utils/watchHistory/resolve'
import { joinEpisodeWatchHistory, plainWatchHistory } from '@src/utils/watchHistory/joinEpisodes'
import { durationMsFrom } from '@components/WatchProgress/progress'
import { yearOf } from '@src/utils/media/detailsFacts'
import {
  showTitleOf,
  tvHrefs,
  seasonLabel,
  seasonQuality,
  episodeRowChips,
  pickNextUp,
  nextUpNoun,
  seasonFacts,
  blurDataURL,
} from '@src/utils/media/tvFacts'
import { tvSeasonPosterName, tvEpisodePosterName } from '@src/utils/viewTransitionNames'
import SyncClientWithServerWatched from '@components/SyncClientWithServerWatched'
import AdminEditButton from '@components/MediaPages/AdminEditButton'
import NoEpisodesFound from './NoEpisodesFound'
import { Trail, MetaLine, FactRow, SECONDARY_CLASSES } from './details/Primitives'
import HeroPoster from './details/HeroPoster'
import ArtworkButton from './details/ArtworkButton'
import ActionRow from './details/ActionRow'
import SeasonEpisodeList from './SeasonEpisodeList'

const EYEBROW = 'text-xs font-semibold uppercase tracking-[0.18em] text-white/60'
const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-300'

function SeasonNotFound({ showTitle, seasonNumber }) {
  return (
    <div className="media-details-page mx-auto w-full max-w-6xl px-4 py-24 text-center sm:px-6 lg:px-8">
      <h1 className="text-2xl font-bold text-white">
        We don&apos;t have {seasonLabel(Number(seasonNumber))} of {showTitle}
      </h1>
      <p className="mt-2 text-sm text-white/60">That season is not in the library.</p>
      <Link href="/list/tv" className={`${SECONDARY_CLASSES} mt-6`}>
        Back to TV
      </Link>
    </div>
  )
}

/**
 * The season info page: a hero with the season's next-up episode, then the
 * episode list (list or grid) with per-episode progress and the action
 * dialog.
 *
 * @param {Object} props
 * @param {string} props.showTitle - already decoded by the route
 * @param {string} [props.originalTitle] - the show's filesystem key, when the route knows it
 * @param {string|number} props.seasonNumber
 * @param {string|null} [props.userId] - the viewer, for next-up and row progress
 */
export default async function TVEpisodesListComponent({ showTitle, originalTitle, seasonNumber, userId = null }) {
  const season = await getFlatTVSeasonWithEpisodes({ showTitle, seasonNumber: parseInt(seasonNumber, 10) })
  if (!season) return <SeasonNotFound showTitle={showTitle} seasonNumber={seasonNumber} />
  if (!season.episodes || season.episodes.length === 0) {
    return <NoEpisodesFound onRetry={refreshEpisodes} showTitle={showTitle} seasonNumber={seasonNumber} season={season} />
  }

  const n = season.seasonNumber
  const summary = season.showSummary || {
    title: season.showTitle || showTitle,
    originalTitle: originalTitle || season.showTitle || showTitle,
  }
  const showDisplay = showTitleOf(summary)
  const showId = season.showId != null ? String(season.showId) : summary.id || null
  const episodes = await joinEpisodeWatchHistory(season.episodes, userId)
  const nextUp = pickNextUp(episodes)
  const ep = nextUp?.episode || null
  const hrefs = tvHrefs({
    originalTitle: summary.originalTitle,
    showTitle: summary.title,
    seasonNumber: n,
    episodeNumber: ep?.episodeNumber,
  })
  const routeKey = encodeURIComponent(summary.originalTitle || summary.title || '')
  const quality = seasonQuality(season.episodes)
  const count = episodes.length
  const overview = season.metadata?.overview || season.overview || null
  const showOverview = season.metadata?.tvOverview || summary.overview || null
  const facts = seasonFacts(season)
  const rows = episodes.map((e) => {
    const h = tvHrefs({ originalTitle: summary.originalTitle, showTitle: summary.title, seasonNumber: n, episodeNumber: e.episodeNumber })
    return {
      _id: e._id != null ? String(e._id) : null,
      showId: e.showId != null ? String(e.showId) : showId,
      seasonNumber: n,
      episodeNumber: e.episodeNumber,
      title: e.title || e.metadata?.name || `Episode ${e.episodeNumber}`,
      overview: e.metadata?.overview || null,
      thumbnail: e.thumbnail || null,
      thumbnailBlurDataURL: blurDataURL(e.thumbnailBlurhash),
      durationMs: durationMsFrom(e),
      videoURL: e.videoURL || null,
      mediaId: isDurableMediaId(e.mediaId) ? e.mediaId : null,
      chips: episodeRowChips(e),
      hrefs: { info: h.episode, play: h.play },
      watchHistory: plainWatchHistory(e.watchHistory),
      viewTransitionName: tvEpisodePosterName(season.showTitle, n, e.episodeNumber),
    }
  })
  const siblingSeasons = (season.siblingSeasons || [])
    .filter((s) => s && s.visibleEpisodeCount > 0)
    .map((s) => ({ seasonNumber: s.seasonNumber, title: s.title ?? null }))
  const selectorSeasons = siblingSeasons.some((s) => s.seasonNumber === n)
    ? siblingSeasons
    : [...siblingSeasons, { seasonNumber: n, title: season.title ?? null }].sort((a, b) => a.seasonNumber - b.seasonNumber)

  return (
    <div className="media-details-page relative mx-auto w-full max-w-6xl px-4 pb-16 sm:px-6 lg:px-8">
      <SyncClientWithServerWatched />
      <div className="flex min-w-0 items-center justify-between gap-4 pt-4">
        <Trail items={[{ label: 'TV', href: '/list/tv' }, { label: showDisplay, href: hrefs.show }, { label: seasonLabel(n) }]} />
        <AdminEditButton variant="subtle" label="Edit season" href={showId ? `/admin/media/tv/${showId}?season=${n}` : null} />
      </div>

      <header className="mt-6 grid grid-cols-[120px_minmax(0,1fr)] gap-x-5 gap-y-6 sm:mt-10 sm:gap-x-8">
        <ViewTransition name={tvSeasonPosterName(season.showTitle, n)}>
          {/* No season-level image list exists, so the viewer shows the show's
              artwork with this season's own poster pinned first */}
          <ArtworkButton
            title={`${showDisplay} · ${seasonLabel(n)}`}
            tmdbId={summary.tmdbId ?? null}
            type="tv"
            inUse={{ poster: { path: season.metadata?.poster_path || null, url: season.posterURL || null, label: 'This season' } }}
            className="row-span-2"
          >
            <HeroPoster src={season.posterURL} alt={`${showDisplay} ${seasonLabel(n)} poster`} blurhash={season.posterBlurhash} widthClassName="w-[120px]" sizes="120px" />
          </ArtworkButton>
        </ViewTransition>

        <div className="min-w-0">
          <p className={EYEBROW}>
            <Link href={hrefs.show} className="hover:text-white">
              {showDisplay}
            </Link>
          </p>
          <h1 className="mt-2 text-balance text-3xl font-bold leading-[1.05] tracking-tight text-white drop-shadow-md sm:text-5xl">{seasonLabel(n)}</h1>
          <MetaLine
            className="mt-3"
            items={[yearOf(season.airDate || season.metadata?.air_date), `${count} episode${count === 1 ? '' : 's'}`]}
            chips={quality.chips}
          />
          {overview ? <p className="mt-3 max-w-[65ch] text-[15px] leading-relaxed text-white/85 sm:text-base">{overview}</p> : null}
          {showOverview || facts.length > 0 ? (
            <details className="group mt-4">
              <summary
                className={`inline-flex cursor-pointer list-none items-center gap-1 rounded text-sm font-medium text-blue-300 hover:text-white ${FOCUS_RING} [&::-webkit-details-marker]:hidden`}
              >
                <ChevronRightIcon className="size-4 transition-transform group-open:rotate-90" aria-hidden="true" />
                More about this season
              </summary>
              <div className="mt-3 max-w-[65ch] space-y-3 text-[15px] leading-relaxed text-white/85">
                {showOverview ? <p>{showOverview}</p> : null}
                {facts.length > 0 ? (
                  <dl className="grid grid-cols-[minmax(6.5rem,max-content)_1fr] gap-x-6 gap-y-2 text-sm">
                    {facts.map((row) => (
                      <FactRow key={row.label} label={row.label} note={row.note}>
                        {Array.isArray(row.value) ? row.value.join(', ') : row.value}
                      </FactRow>
                    ))}
                  </dl>
                ) : null}
              </div>
            </details>
          ) : null}
        </div>

        <div className="col-span-2 self-start sm:col-span-1 sm:col-start-2">
          {ep && ep.videoURL && hrefs.play ? (
            <ActionRow
              videoURL={ep.videoURL}
              mediaId={ep.mediaId || null}
              durationMs={durationMsFrom(ep)}
              playHref={hrefs.play}
              noun={nextUpNoun(nextUp, 'season')}
              watchHistory={plainWatchHistory(ep.watchHistory)}
              trailerUrl={null}
              watchlist={null}
            >
              {hrefs.episode ? (
                <Link href={hrefs.episode} className={SECONDARY_CLASSES}>
                  <InformationCircleIcon className="size-5" aria-hidden="true" />
                  Episode details
                </Link>
              ) : null}
            </ActionRow>
          ) : null}
        </div>
      </header>

      <section aria-labelledby="episodes-heading" className="mt-10 sm:mt-14">
        <SeasonEpisodeList episodes={rows} seasons={selectorSeasons} current={n} routeKey={routeKey} />
      </section>
    </div>
  )
}
