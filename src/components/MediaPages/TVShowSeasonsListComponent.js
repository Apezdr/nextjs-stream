// Auth (and the unauthenticated fallback) is the route's <AuthGuard>. This
// component renders inside the route's 'use cache' subtree (TVShowContent),
// whose cache key includes the viewer id it passes down — the per-viewer
// pieces here (next-up, season status) are safe only because `userId`
// arrives as a prop from that cached function's argument. Never read the
// session or any other dynamic API here.
import { ViewTransition } from 'react'
import Link from 'next/link'
import { getFlatRequestedMedia, getFlatShowEpisodesForProgress } from '@src/utils/flatDatabaseUtils'
import { joinEpisodeWatchHistory, plainWatchHistory } from '@src/utils/watchHistory/joinEpisodes'
import { durationMsFrom } from '@components/WatchProgress/progress'
import { artworkInUse } from '@src/utils/media/artwork'
import { tvPosterName, tvSeasonPosterName } from '@src/utils/viewTransitionNames'
import {
  showTitleOf,
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
  showFacts,
} from '@src/utils/media/tvFacts'
import SyncClientWithServerWatched from '@components/SyncClientWithServerWatched'
import WatchlistButton from '@components/WatchlistButton'
import AdminEditButton from '@components/MediaPages/AdminEditButton'
import { Trail, MetaLine, SectionHeading, DetailsPanel, SECONDARY_CLASSES } from './details/Primitives'
import HeroPoster from './details/HeroPoster'
import ArtworkButton from './details/ArtworkButton'
import PrimaryPlayButton from './details/PrimaryPlayButton'
import SeasonTile from './details/SeasonTile'
import CastRail from './details/CastRail'
import ShowNextUpLine from './ShowNextUpLine'

const EYEBROW = 'text-xs font-semibold uppercase tracking-[0.18em] text-white/60'

/** A show document as the loader returns it, rather than a trailer stand-in. */
function isShowDoc(show) {
  return Boolean(show && show._id && Array.isArray(show.seasons))
}

/** Genre names from TMDB metadata first, then the synced top-level list. */
function genreNamesOf(doc) {
  const source = Array.isArray(doc.metadata?.genres) && doc.metadata.genres.length ? doc.metadata.genres : doc.genres
  return (Array.isArray(source) ? source : []).map((g) => (typeof g === 'string' ? g : g?.name)).filter(Boolean)
}

function ShowNotFound({ title }) {
  return (
    <div className="media-details-page mx-auto w-full max-w-6xl px-4 py-24 text-center sm:px-6 lg:px-8">
      <h1 className="text-2xl font-bold text-white">We don&apos;t have {title}</h1>
      <p className="mt-2 text-sm text-white/60">That show is not in the library.</p>
      <Link href="/list/tv" className={`${SECONDARY_CLASSES} mt-6`}>
        Back to TV
      </Link>
    </div>
  )
}

/**
 * The show info page: a hero with the viewer's next-up episode, the seasons
 * grid (TMDB's list merged with what the library holds), the series cast
 * and the show facts.
 *
 * @param {Object} props
 * @param {string} props.showTitle - already decoded by the route
 * @param {Object|null} [props.show] - the show document when the route fetched it
 * @param {string|null} [props.userId] - the viewer, for next-up and season status
 */
export default async function TVShowSeasonsList({ showTitle, show = null, userId = null }) {
  const doc = isShowDoc(show) ? show : await getFlatRequestedMedia({ type: 'tv', title: showTitle })
  if (!doc) return <ShowNotFound title={showTitle} />

  const m = doc.metadata || {}
  const display = showTitleOf(doc)
  const rawEpisodes = doc._id ? await getFlatShowEpisodesForProgress(doc._id) : []
  const episodes = await joinEpisodeWatchHistory(rawEpisodes, userId)
  const nextUp = pickNextUp(episodes)
  const ep = nextUp?.episode || null
  const tiles = mergeSeasons(doc, episodes)
  const hrefs = tvHrefs({
    originalTitle: doc.originalTitle,
    showTitle: doc.title,
    seasonNumber: ep?.seasonNumber,
    episodeNumber: ep?.episodeNumber,
  })
  const eyebrow = showEyebrow(doc)
  const statusChip = showStatusChip(m)
  const genreNames = genreNamesOf(doc)
  const overview = m.overview || doc.overview || null
  const inProgressSeason = nextUp && (nextUp.kind === 'resume' || nextUp.kind === 'next') ? ep.seasonNumber : null
  const cast = Array.isArray(m.cast) ? m.cast : []
  const facts = showFacts(doc, { libraryEpisodeCount: episodes.length })
  const epHistory = ep ? plainWatchHistory(ep.watchHistory) : null
  const nextUpProps = ep
    ? {
        kind: nextUp.kind,
        episode: {
          title: ep.title ?? null,
          metadata: { name: ep.metadata?.name ?? null },
          seasonNumber: ep.seasonNumber,
          episodeNumber: ep.episodeNumber,
          videoURL: ep.videoURL ?? null,
          mediaId: ep.mediaId ?? null,
          durationMs: durationMsFrom(ep),
          watchHistory: epHistory,
        },
      }
    : null
  const badge =
    inProgressSeason != null ? (
      <span className="rounded-full bg-blue-500/20 px-3 py-1 text-xs font-semibold text-blue-200">
        {seasonLabel(inProgressSeason)} in progress
      </span>
    ) : null

  return (
    <div className="media-details-page relative mx-auto w-full max-w-6xl px-4 pb-16 sm:px-6 lg:px-8">
      <SyncClientWithServerWatched />
      <div className="flex min-w-0 items-center justify-between gap-4 pt-4">
        <Trail items={[{ label: 'TV', href: '/list/tv' }, { label: display }]} />
        <AdminEditButton variant="subtle" label="Edit show" href={doc._id ? `/admin/media/tv/${doc._id}` : null} />
      </div>

      <header className="mt-6 grid grid-cols-[120px_minmax(0,1fr)] gap-x-5 gap-y-6 sm:mt-10 sm:grid-cols-[170px_minmax(0,1fr)] sm:gap-x-8 lg:grid-cols-[minmax(0,1fr)_230px] lg:gap-x-10">
        <div className="col-start-2 row-start-1 min-w-0 lg:col-start-1">
          {eyebrow ? <p className={EYEBROW}>{eyebrow}</p> : null}
          <h1 className="mt-2 text-balance text-3xl font-bold leading-[1.05] tracking-tight text-white drop-shadow-md sm:text-5xl">{display}</h1>
          <MetaLine
            className="mt-3"
            items={[showYears(m), genreNames.length ? genreNames.join(' / ') : null]}
            chips={statusChip ? [{ label: statusChip, tone: 'status' }] : []}
          />
          {m.tagline ? <p className="mt-4 text-base italic text-white/70">{m.tagline}</p> : null}
          {overview ? <p className="mt-3 max-w-[65ch] text-[15px] leading-relaxed text-white/85 sm:text-base">{overview}</p> : null}
        </div>

        <div className="col-start-1 row-start-1 sm:row-span-2 lg:col-start-2">
          <ViewTransition name={tvPosterName(doc.title)}>
            <ArtworkButton title={display} tmdbId={m.id ?? null} type="tv" inUse={artworkInUse(doc)}>
              <HeroPoster
                src={doc.posterURL}
                alt={`${display} poster`}
                blurhash={doc.posterBlurhash}
                widthClassName="w-[120px] sm:w-[170px] lg:w-[230px]"
                sizes="(max-width: 640px) 120px, (max-width: 1024px) 170px, 230px"
              />
            </ArtworkButton>
          </ViewTransition>
        </div>

        <div id="show-hero-actions" className="col-span-2 row-start-2 self-start sm:col-span-1 sm:col-start-2 lg:col-start-1">
          <div className="flex flex-wrap items-center gap-3">
            {ep && ep.videoURL && hrefs.play ? (
              <PrimaryPlayButton
                videoURL={ep.videoURL}
                mediaId={ep.mediaId || null}
                durationMs={durationMsFrom(ep)}
                playHref={hrefs.play}
                noun={nextUpNoun(nextUp, 'show')}
                watchHistory={epHistory}
                className="w-full sm:w-auto"
              />
            ) : null}
            <WatchlistButton mediaId={doc._id} tmdbId={m.id} mediaType="tv" title={display} variant="outline" />
          </div>
          {nextUpProps ? <ShowNextUpLine nextUp={nextUpProps} totalEpisodes={episodes.length} className="mt-3 text-sm text-white/70" /> : null}
        </div>
      </header>

      <section aria-labelledby="seasons-heading" className="mt-10 sm:mt-14">
        <SectionHeading id="seasons-heading" aside={badge}>
          Seasons
        </SectionHeading>
        {tiles.length > 0 ? <p className="-mt-2 mb-4 text-sm text-white/55">{seasonsSummary(doc, tiles)}</p> : null}
        {tiles.length === 0 ? (
          <p className="text-sm text-white/55">No seasons in your library yet.</p>
        ) : (
          <ul className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
            {tiles.map((tile) => (
              <li key={tile.seasonNumber}>
                <SeasonTile
                  seasonNumber={tile.seasonNumber}
                  title={tile.title}
                  href={tile.href}
                  posterURL={tile.posterURL}
                  posterBlurhash={tile.posterBlurhash}
                  available={tile.available}
                  year={tile.year}
                  episodeCount={tile.episodeCount}
                  status={seasonTileStatus({ seasonNumber: tile.seasonNumber, episodes, nextUp })}
                  viewTransitionName={tvSeasonPosterName(doc.title, tile.seasonNumber)}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      {cast.length > 0 || facts.length > 0 ? (
        <div className="mt-10 space-y-12 rounded-2xl bg-[#070b1d]/65 px-4 py-8 ring-1 ring-white/5 sm:mt-14 sm:px-6 lg:px-8">
          {cast.length > 0 ? <CastRail cast={cast} title="Cast" /> : null}
          <DetailsPanel id="show-details" title="Show details" rows={facts} />
        </div>
      ) : null}
    </div>
  )
}
