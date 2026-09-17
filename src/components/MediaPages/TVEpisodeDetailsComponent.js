import { Suspense, ViewTransition } from 'react'
import Link from 'next/link'
import { tvEpisodePosterName } from '@src/utils/viewTransitionNames'
import { splitTitle, qualityChips, certificationOf, episodeFacts, episodeTypeLabel, formatDate } from '@src/utils/media/detailsFacts'
import { tvHrefs, seasonLabel, blurDataURL } from '@src/utils/media/tvFacts'
import { durationMsFrom, formatRuntime } from '@components/WatchProgress/progress'
import WatchProgressPanel from '@components/WatchProgress/WatchProgressPanel'
import AdminEditButton from '@components/MediaPages/AdminEditButton'
import { WatchedByLine } from './ViewCount'
import { Trail, MetaLine, DetailsPanel } from './details/Primitives'
import EpisodeThumbnail from './details/EpisodeThumbnail'
import ActionRow from './details/ActionRow'
import StickyTitleBar from './details/StickyTitleBar'
import CastTabs from './details/CastTabs'
import EpisodeNav from './details/EpisodeNav'
import NextEpisodeCard from './details/NextEpisodeCard'

/** The hero's action row; the sticky bar appears once this scrolls out. */
const ACTIONS_ID = 'episode-hero-actions'
const EYEBROW = 'text-xs font-semibold uppercase tracking-[0.18em] text-white/60'

const pad2 = (n) => String(n).padStart(2, '0')

/**
 * The episode info page: the show and season as the eyebrow, the episode
 * as the title, the still beside it, then the previous/next rail, the
 * cast tabs with the episode facts, and the next episode's card.
 *
 * Renders inside a `'use cache'` subtree shared by every viewer, so
 * nothing here may read per-user state: the primary button's label, the
 * resume block and the sticky bar read the viewer's position on the client,
 * and the admin edit link decides its own visibility after hydration.
 *
 * A limited-access viewer gets the show's trailer stand-in as `media`,
 * which carries none of the counts or neighbours; every one of those is
 * guarded so the page still renders.
 */
const TVEpisodeDetailsComponent = ({ media }) => {
  if (!media) {
    return <div className="text-center py-4">Loading...</div>
  }

  const metadata = media.metadata || {}
  const { air_date, overview, tagline, trailer_url, name, guest_stars, episode_type } = metadata
  const { title, showTitle, originalTitle, seasonNumber, episodeNumber, duration } = media

  const episodeTitle = name || title || `Episode ${episodeNumber}`
  const { headline, subtitle } = splitTitle(episodeTitle)
  const durationMs = durationMsFrom({ duration, metadata })
  const hrefs = tvHrefs({ originalTitle, showTitle, seasonNumber, episodeNumber })
  const seasonName = seasonLabel(seasonNumber)
  const code = `S${pad2(seasonNumber)}E${pad2(episodeNumber)}`
  const finale = episodeTypeLabel(episode_type)
  const chips = [...(finale ? [finale] : []), ...qualityChips(media)]
  // What the progress-aware pieces (primary button, resume panel, sticky bar) need to look the position up
  const progressProps = { videoURL: media.videoURL || null, mediaId: media.mediaId || null, durationMs }
  const stickyTitle = `${code} · ${headline}`

  const count = Number.isInteger(media.seasonEpisodeCount) && media.seasonEpisodeCount > 0 ? media.seasonEpisodeCount : null
  const neighbour = (n, epTitle) =>
    n != null && hrefs.season ? { href: tvHrefs({ originalTitle, showTitle, seasonNumber, episodeNumber: n }).episode, episodeNumber: n, title: epTitle ?? null } : null
  const prev = neighbour(media.previousEpisodeNumber, media.previousEpisodeTitle)
  const next = media.hasNextEpisode ? neighbour(media.nextEpisodeNumber, media.nextEpisodeTitle) : null

  const facts = [
    ...(hrefs.show && showTitle ? [{ label: 'Show', value: showTitle, links: [{ label: showTitle, href: hrefs.show, external: false }] }] : []),
    ...(hrefs.season ? [{ label: 'Season', value: seasonName, links: [{ label: seasonName, href: hrefs.season, external: false }] }] : []),
    ...(count ? [{ label: 'Episode', value: `${episodeNumber} of ${count}` }] : []),
    ...episodeFacts(media),
  ]
  const tabs = [
    { id: 'guests', label: 'Guest stars', cast: media.guestStars || guest_stars || [] },
    { id: 'series', label: 'Series cast', cast: media.cast || [] },
  ]
  const nextChips = next ? qualityChips({ dimensions: media.nextEpisodeDimensions, hdr: media.nextEpisodeHdr }).filter((c) => c !== 'SDR') : []

  return (
    <div className="media-details-page relative mx-auto w-full max-w-6xl px-4 pb-16 sm:px-6 lg:px-8">
      <div className="flex min-w-0 items-center justify-between gap-4 pt-4">
        <Trail
          items={[
            { label: 'TV', href: '/list/tv' },
            { label: showTitle || 'Show', href: hrefs.show },
            { label: seasonName, href: hrefs.season },
            { label: `Episode ${episodeNumber}` },
          ]}
        />
        <AdminEditButton
          variant="subtle"
          label="Edit episode"
          href={media.showMediaId ? `/admin/media/tv/${media.showMediaId}?season=${seasonNumber}&episode=${episodeNumber}` : null}
        />
      </div>

      <header className="mt-6 grid gap-6 sm:mt-10 lg:grid-cols-[minmax(0,55fr)_minmax(0,45fr)] lg:gap-x-10">
        <div className="min-w-0 lg:col-start-1 lg:row-start-1">
          <p className={EYEBROW}>
            {hrefs.show ? (
              <Link href={hrefs.show} className="hover:text-white">
                {showTitle}
              </Link>
            ) : (
              showTitle
            )}
            <span className="text-white/40"> / </span>
            {hrefs.season ? (
              <Link href={hrefs.season} className="hover:text-white">
                {seasonName}
              </Link>
            ) : (
              seasonName
            )}
            <span className="text-white/40"> · </span>
            Episode {episodeNumber}
          </p>
          <h1 className="mt-2 text-balance text-3xl font-bold leading-[1.05] tracking-tight text-white drop-shadow-md sm:text-5xl">{headline}</h1>
          {subtitle ? <p className="mt-1.5 text-balance text-xl font-semibold leading-tight text-white/85 sm:text-3xl">{subtitle}</p> : null}
          <MetaLine className="mt-3" items={[formatDate(air_date), formatRuntime(durationMs), certificationOf(metadata)]} chips={chips} />
          {tagline ? <p className="mt-4 text-base italic text-white/70">{tagline}</p> : null}
          {overview ? <p className="mt-3 max-w-[65ch] text-[15px] leading-relaxed text-white/85 sm:text-base">{overview}</p> : null}
        </div>

        <div className="order-first lg:order-none lg:col-start-2 lg:row-span-2 lg:row-start-1">
          <ViewTransition name={tvEpisodePosterName(showTitle, seasonNumber, episodeNumber)}>
            <EpisodeThumbnail
              src={media.thumbnail || null}
              blurDataURL={blurDataURL(media.thumbnailBlurhash)}
              alt={`${episodeTitle} still`}
              sizes="(max-width: 1024px) 100vw, 480px"
              priority
              className="shadow-2xl shadow-black/60"
            />
          </ViewTransition>
          {media.normalizedVideoId ? (
            <Suspense fallback={null}>
              <WatchedByLine normalizedVideoId={media.normalizedVideoId} mediaId={media.mediaId || null} className="mt-2 justify-end" />
            </Suspense>
          ) : null}
        </div>

        <div id={ACTIONS_ID} className="self-start lg:col-start-1 lg:row-start-2">
          <ActionRow
            {...progressProps}
            playHref={hrefs.play}
            trailerUrl={trailer_url || null}
            watchlist={showTitle ? { mediaId: media.showMediaId, tmdbId: media.showTmdbId, mediaType: 'tv', title: showTitle } : null}
            noun="episode"
            restartNoun=""
          />
          {media.videoURL ? <WatchProgressPanel {...progressProps} playHref={hrefs.play} className="mt-5 max-w-xl" /> : null}
        </div>
      </header>

      <EpisodeNav className="mt-8" previous={prev} all={count && hrefs.season ? { href: hrefs.season, count } : null} next={next} />

      <StickyTitleBar sentinelId={ACTIONS_ID} title={stickyTitle} subtitle={subtitle} {...progressProps} playHref={hrefs.play} />

      <div className="mt-10 grid gap-8 rounded-2xl bg-[#070b1d]/65 px-4 py-8 ring-1 ring-white/5 sm:mt-14 sm:px-6 lg:grid-cols-2 lg:px-8">
        <CastTabs tabs={tabs} defaultTab="guests" />
        <DetailsPanel id="episode-details" title="Episode details" rows={facts} />
      </div>

      {next ? (
        <NextEpisodeCard
          className="mt-10"
          href={next.href}
          seasonNumber={seasonNumber}
          episodeNumber={next.episodeNumber}
          title={next.title}
          thumbnail={media.nextEpisodeThumbnail || null}
          blurDataURL={blurDataURL(media.nextEpisodeThumbnailBlurhash)}
          durationMs={media.nextEpisodeDuration ?? null}
          chips={nextChips}
        />
      ) : null}
    </div>
  )
}

export default TVEpisodeDetailsComponent
