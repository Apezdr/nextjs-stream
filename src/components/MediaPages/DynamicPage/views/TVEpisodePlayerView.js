/**
 * TV Episode Player View
 * 
 * Renders the media player for TV episodes with episode list for navigation.
 * Route: /list/tv/{show}/{season}/{episode}/play
 */

import { Suspense } from 'react'
import MediaPlayerComponent from '@src/components/MediaPlayer/MediaPlayer'
import EpisodeListComponent from '@src/components/MediaPlayer/EpisodeListComponent'
import { PlaybackCoordinatorProvider } from '@src/contexts/PlaybackCoordinatorContext'
import SyncClientWithServerWatched from '@src/components/SyncClientWithServerWatched'
import Loading from '@src/app/loading'
import { validateVideoURL } from '@src/utils/media/mediaFetcher'
import { buildMediaUrl } from '@src/utils/media/urlParser'

/**
 * TVEpisodePlayerView Component
 * 
 * @param {Object} props
 * @param {Object} props.media - Episode media object
 * @param {Object} props.session - NextAuth session
 * @param {Object} props.searchParams - URL search parameters (includes start time)
 * @param {Object} props.parsedParams - Parsed URL parameters
 */
export default async function TVEpisodePlayerView({ media, session, searchParams, parsedParams }) {
  const { mediaTitle, mediaSeason, mediaEpisode } = parsedParams
  
  // Validate video URL
  const isValidVideoURL = media?.videoURL && await validateVideoURL(media.videoURL)
  
  // Build go back URL (to episode details, not player)
  const goBackUrl = buildMediaUrl({
    mediaType: 'tv',
    mediaTitle,
    mediaSeason,
    mediaEpisode,
    includePlay: false,
  })
  
  return (
    <PlaybackCoordinatorProvider>
      <>
        <div className="flex flex-col items-center justify-center min-h-screen">
          <SyncClientWithServerWatched once={true} />
          <Suspense fallback={<Loading />}>
            <MediaPlayerComponent
              media={media}
              mediaTitle={mediaTitle}
              mediaType="tv"
              goBack={goBackUrl}
              searchParams={searchParams}
              session={session}
              isValidVideoURL={isValidVideoURL}
            />
          </Suspense>
        </div>
        
        {/* Episode list for easier navigation */}
        <Suspense fallback={<Loading />}>
          <div className="w-full md:py-12">
            <EpisodeListComponent
              mediaTitle={decodeURIComponent(mediaTitle)}
              mediaSeason={mediaSeason}
              mediaEpisode={mediaEpisode}
            />
          </div>
        </Suspense>
      </>
    </PlaybackCoordinatorProvider>
  )
}