/**
 * Movie Player View
 * 
 * Renders the media player for movies with playback controls.
 * Route: /list/movie/{title}/play
 */

import { Suspense } from 'react'
import MediaPlayerComponent from '@src/components/MediaPlayer/MediaPlayer'
import { PlaybackCoordinatorProvider } from '@src/contexts/PlaybackCoordinatorContext'
import SyncClientWithServerWatched from '@src/components/SyncClientWithServerWatched'
import Loading from '@src/app/loading'
import { validateVideoURL } from '@src/utils/media/mediaFetcher'
import { buildGoBackUrl } from '@src/utils/media/urlParser'

/**
 * MoviePlayerView Component
 * 
 * @param {Object} props
 * @param {Object} props.media - Movie media object
 * @param {Object} props.session - NextAuth session
 * @param {Object} props.searchParams - URL search parameters (includes start time)
 * @param {Object} props.parsedParams - Parsed URL parameters
 */
export default async function MoviePlayerView({ media, session, searchParams, parsedParams }) {
  // Validate video URL
  const isValidVideoURL = media?.videoURL && await validateVideoURL(media.videoURL)
  
  // Build go back URL
  const goBackUrl = buildGoBackUrl(parsedParams)
  
  return (
    <>
      <SyncClientWithServerWatched once={true} />
      <Suspense fallback={<Loading />}>
        <PlaybackCoordinatorProvider>
          <div className="flex flex-col items-center justify-center min-h-screen">
            <MediaPlayerComponent
              media={media}
              mediaTitle={parsedParams.mediaTitle}
              mediaType={parsedParams.mediaType}
              goBack={goBackUrl}
              searchParams={searchParams}
              session={session}
              isValidVideoURL={isValidVideoURL}
            />
          </div>
        </PlaybackCoordinatorProvider>
      </Suspense>
    </>
  )
}