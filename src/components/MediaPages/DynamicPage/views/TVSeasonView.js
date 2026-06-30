/**
 * TV Season View
 *
 * Displays list of episodes for a specific season.
 * Route: /list/tv/{show}/{season}
 */

import { Suspense } from 'react'
import TVEpisodesListComponent from '@src/components/MediaPages/TVEpisodesListComponent'
import Loading from '@src/app/loading'

/**
 * TVSeasonView Component
 *
 * @param {Object} props
 * @param {Object} props.media - Season media object
 * @param {Object} props.parsedParams - Parsed URL parameters
 * @param {string} [props.userId] - Current user id (for watch-history personalization)
 */
export default function TVSeasonView({ media, parsedParams, userId }) {
  const { mediaTitle, mediaSeason } = parsedParams

  return (
    <Suspense fallback={<Loading />}>
      <TVEpisodesListComponent
        showTitle={mediaTitle}
        originalTitle={media?.originalTitle}
        seasonNumber={mediaSeason}
        userId={userId}
      />
    </Suspense>
  )
}
