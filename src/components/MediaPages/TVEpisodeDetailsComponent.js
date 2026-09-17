import { Suspense, ViewTransition } from 'react'
import { tvSeasonPosterName } from '@src/utils/viewTransitionNames'
import { splitTitle, qualityChips, certificationOf, episodeFacts, episodeTypeLabel, formatDate } from '@src/utils/media/detailsFacts'
import { durationMsFrom, formatRuntime } from '@components/WatchProgress/progress'
import WatchProgressPanel from '@components/WatchProgress/WatchProgressPanel'
import AdminEditButton from '@components/MediaPages/AdminEditButton'
import { WatchedByRow } from './ViewCount'
import { Breadcrumb, MetaLine, DetailsPanel } from './details/Primitives'
import HeroPoster from './details/HeroPoster'
import ActionRow from './details/ActionRow'
import StickyTitleBar from './details/StickyTitleBar'
import CastRail from './details/CastRail'

/** The hero's action row; the sticky bar appears once this scrolls out. */
const ACTIONS_ID = 'episode-hero-actions'

const pad2 = (n) => String(n).padStart(2, '0')

/**
 * The episode info page: the same frame as the movie page, with the show as
 * the eyebrow, the episode as the title, SxxExx on the meta line and the
 * episode's own credits at the top of the details panel.
 *
 * Renders inside a `'use cache'` subtree shared by every viewer; see
 * MovieDetailsComponent for what that rules out.
 */
const TVEpisodeDetailsComponent = ({ media }) => {
  if (!media) {
    return <div className="text-center py-4">Loading...</div>
  }

  const metadata = media.metadata || {}
  const { air_date, genres, overview, tagline, trailer_url, name, guest_stars, episode_type } = metadata
  const { title, showTitle, originalTitle, seasonNumber, episodeNumber, cast, duration, posterURL, posterBlurhash } = media

  const episodeTitle = name || title || `Episode ${episodeNumber}`
  const { headline, subtitle } = splitTitle(episodeTitle)
  const durationMs = durationMsFrom({ duration, metadata })
  const routeKey = encodeURIComponent(originalTitle || showTitle)
  const seasonHref = `/list/tv/${routeKey}/${seasonNumber}`
  const playHref = `/list/tv/${routeKey}/${seasonNumber}/${episodeNumber}/play`
  const code = `S${pad2(seasonNumber)}E${pad2(episodeNumber)}`
  const finale = episodeTypeLabel(episode_type)
  const chips = [...(finale ? [finale] : []), ...qualityChips(media)]
  const facts = episodeFacts(media)
  const genreNames = (genres || []).map((g) => g?.name).filter(Boolean)
  // What the progress-aware pieces (primary button, resume panel, sticky bar) need to look the position up
  const progressProps = { videoURL: media.videoURL || null, mediaId: media.mediaId || null, durationMs }
  const stickyTitle = `${code} · ${headline}`

  return (
    <div className="media-details-page relative mx-auto w-full max-w-6xl px-4 pb-16 sm:px-6 lg:px-8">
      <div className="flex min-w-0 items-center justify-between gap-4 pt-4">
        <Breadcrumb href={seasonHref}>
          <span className="truncate">
            {showTitle} · Season {seasonNumber}
          </span>
        </Breadcrumb>
        <AdminEditButton
          variant="subtle"
          label="Edit episode"
          href={media.showMediaId ? `/admin/media/tv/${media.showMediaId}?season=${seasonNumber}&episode=${episodeNumber}` : null}
        />
      </div>

      <header className="mt-6 grid grid-cols-[120px_minmax(0,1fr)] gap-x-5 gap-y-6 sm:mt-10 sm:grid-cols-[170px_minmax(0,1fr)] sm:gap-x-8 lg:grid-cols-[220px_minmax(0,1fr)]">
        <ViewTransition name={tvSeasonPosterName(showTitle, seasonNumber)}>
          <HeroPoster src={posterURL} alt={`${showTitle} season ${seasonNumber} poster`} blurhash={posterBlurhash} className="sm:row-span-2" />
        </ViewTransition>

        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/60">
            {showTitle}
            {genreNames.length > 0 ? <span className="text-white/40"> · {genreNames.slice(0, 3).join(' · ')}</span> : null}
          </p>
          <h1 className="mt-2 text-balance text-3xl font-bold leading-[1.05] tracking-tight text-white drop-shadow-md sm:text-5xl">{headline}</h1>
          {subtitle ? <p className="mt-1.5 text-balance text-xl font-semibold leading-tight text-white/85 sm:text-3xl">{subtitle}</p> : null}
          <MetaLine className="mt-3" items={[code, formatDate(air_date), formatRuntime(durationMs), certificationOf(metadata)]} chips={chips} />
          {tagline ? <p className="mt-4 text-base italic text-white/70">{tagline}</p> : null}
          {overview ? <p className="mt-3 max-w-[65ch] text-[15px] leading-relaxed text-white/85 sm:text-base">{overview}</p> : null}
        </div>

        <div id={ACTIONS_ID} className="col-span-2 self-start sm:col-span-1 sm:col-start-2">
          <ActionRow
            {...progressProps}
            playHref={playHref}
            trailerUrl={trailer_url || null}
            watchlist={showTitle ? { mediaId: media.showMediaId, tmdbId: media.showTmdbId, mediaType: 'tv', title: showTitle } : null}
          />
          {media.videoURL ? <WatchProgressPanel {...progressProps} playHref={playHref} className="mt-5 max-w-xl" /> : null}
        </div>
      </header>

      <StickyTitleBar sentinelId={ACTIONS_ID} title={stickyTitle} subtitle={subtitle} {...progressProps} playHref={playHref} />

      <div className="mt-10 space-y-12 rounded-2xl bg-[#070b1d]/65 px-4 py-8 ring-1 ring-white/5 sm:mt-14 sm:px-6 lg:px-8">
        {guest_stars && guest_stars.length > 0 ? <CastRail cast={guest_stars} title="Guest stars" /> : null}
        {cast && cast.length > 0 ? <CastRail cast={cast} /> : null}

        <DetailsPanel id="episode-details" title="Episode details" rows={facts}>
          {media.normalizedVideoId ? (
            <Suspense fallback={null}>
              <WatchedByRow normalizedVideoId={media.normalizedVideoId} mediaId={media.mediaId || null} />
            </Suspense>
          ) : null}
        </DetailsPanel>
      </div>
    </div>
  )
}

export default TVEpisodeDetailsComponent
