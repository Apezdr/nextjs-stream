import { Suspense, ViewTransition } from 'react'
import { classNames } from '@src/utils'
import { moviePosterName } from '@src/utils/viewTransitionNames'
import { mediaLinkParam } from '@src/utils/media/urlParser'
import { artworkInUse } from '@src/utils/media/artwork'
import { displayTitleOf, splitTitle, yearOf, qualityChips, certificationOf, movieFacts } from '@src/utils/media/detailsFacts'
import { durationMsFrom, formatRuntime } from '@components/WatchProgress/progress'
import WatchProgressPanel from '@components/WatchProgress/WatchProgressPanel'
import AdminEditButton from '@components/MediaPages/AdminEditButton'
import { WatchedByRow } from './ViewCount'
import { Breadcrumb, MetaLine, DetailsPanel } from './details/Primitives'
import HeroPoster from './details/HeroPoster'
import ArtworkButton from './details/ArtworkButton'
import ActionRow from './details/ActionRow'
import StickyTitleBar from './details/StickyTitleBar'
import CastRail from './details/CastRail'
import CollectionCard from './details/CollectionCard'

/** The hero's action row; the sticky bar appears once this scrolls out. */
const ACTIONS_ID = 'movie-hero-actions'

/**
 * The movie info page.
 *
 * Renders inside a `'use cache'` subtree shared by every viewer, so nothing
 * here may read per-user state: the primary button's label, the resume
 * block and the sticky bar read the viewer's position on the client, and
 * the admin edit link decides its own visibility after hydration.
 *
 * The page carries the `media-details-page` marker class: globals.css uses
 * it (`body:has(...)`) to lift the fixed backdrop's cover so the hero shows
 * the art at ~40% with a scrim toward the text edge.
 */
const MovieDetailsComponent = ({ media }) => {
  if (!media) {
    return <div className="text-center py-4">Loading...</div>
  }

  const { posterURL, posterBlurhash, metadata, duration } = media
  const { release_date, genres, overview, tagline, trailer_url } = metadata || {}
  const cast = media.cast || metadata?.cast || []
  const collection = metadata?.belongs_to_collection

  const title = displayTitleOf(media)
  const { headline, subtitle } = splitTitle(title)
  const durationMs = durationMsFrom({ duration, metadata })
  const playHref = `/list/movie/${mediaLinkParam(media)}/play`
  const chips = qualityChips(media)
  const facts = movieFacts(media)
  const genreNames = (genres || []).map((g) => g?.name).filter(Boolean)
  // What the progress-aware pieces (primary button, resume panel, sticky bar) need to look the position up
  const progressProps = { videoURL: media.videoURL || null, mediaId: media.mediaId || null, durationMs }

  return (
    <div className="media-details-page relative mx-auto w-full max-w-6xl px-4 pb-16 sm:px-6 lg:px-8">
      <div className="flex items-center justify-between gap-4 pt-4">
        <Breadcrumb href="/list/movie">Back to movies</Breadcrumb>
        <AdminEditButton variant="subtle" label="Edit movie" href={media._id ? `/admin/media/movies/${media._id}` : null} />
      </div>

      <header className="mt-6 grid grid-cols-[120px_minmax(0,1fr)] gap-x-5 gap-y-6 sm:mt-10 sm:grid-cols-[170px_minmax(0,1fr)] sm:gap-x-8 lg:grid-cols-[220px_minmax(0,1fr)]">
        <ViewTransition name={moviePosterName(media.title)}>
          <ArtworkButton title={title} tmdbId={metadata?.id ?? null} type="movie" inUse={artworkInUse(media)} className="sm:row-span-2">
            <HeroPoster src={posterURL} alt={`${title} poster`} blurhash={posterBlurhash} />
          </ArtworkButton>
        </ViewTransition>

        <div className="min-w-0">
          {genreNames.length > 0 ? (
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/60">{genreNames.slice(0, 4).join(' · ')}</p>
          ) : null}
          <h1 className="mt-2 text-balance text-3xl font-bold leading-[1.05] tracking-tight text-white drop-shadow-md sm:text-5xl">{headline}</h1>
          {subtitle ? <p className="mt-1.5 text-balance text-xl font-semibold leading-tight text-white/85 sm:text-3xl">{subtitle}</p> : null}
          <MetaLine className="mt-3" items={[yearOf(release_date), formatRuntime(durationMs), certificationOf(metadata)]} chips={chips} />
          {tagline ? <p className="mt-4 text-base italic text-white/70">{tagline}</p> : null}
          {overview ? <p className="mt-3 max-w-[65ch] text-[15px] leading-relaxed text-white/85 sm:text-base">{overview}</p> : null}
        </div>

        <div id={ACTIONS_ID} className="col-span-2 self-start sm:col-span-1 sm:col-start-2">
          <ActionRow
            {...progressProps}
            playHref={playHref}
            trailerUrl={trailer_url || null}
            watchlist={{ mediaId: media.id ?? media._id, tmdbId: metadata?.id, mediaType: 'movie', title }}
          />
          {media.videoURL ? <WatchProgressPanel {...progressProps} playHref={playHref} className="mt-5 max-w-xl" /> : null}
        </div>
      </header>

      <StickyTitleBar sentinelId={ACTIONS_ID} title={headline} subtitle={subtitle} {...progressProps} playHref={playHref} />

      <div className="mt-10 space-y-12 rounded-2xl bg-[#070b1d]/65 px-4 py-8 ring-1 ring-white/5 sm:mt-14 sm:px-6 lg:px-8">
        {cast.length > 0 ? <CastRail cast={cast} /> : null}

        <div className={classNames('grid gap-8', collection ? 'lg:grid-cols-2' : '')}>
          {collection ? (
            <Suspense fallback={<div className="h-52 animate-pulse rounded-xl bg-white/5" />}>
              <CollectionCard collection={collection} currentOriginalTitle={media.originalTitle || null} />
            </Suspense>
          ) : null}
          <DetailsPanel id="movie-details" title="Movie details" rows={facts}>
            {media.normalizedVideoId ? (
              <Suspense fallback={null}>
                <WatchedByRow normalizedVideoId={media.normalizedVideoId} mediaId={media.mediaId || null} />
              </Suspense>
            ) : null}
          </DetailsPanel>
        </div>
      </div>
    </div>
  )
}

export default MovieDetailsComponent
