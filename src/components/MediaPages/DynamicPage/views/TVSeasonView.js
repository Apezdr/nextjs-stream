/**
 * TV Season View
 *
 * Displays list of episodes for a specific season.
 * Route: /list/tv/{show}/{season}
 */

import { Suspense } from 'react'
import TVEpisodesListComponent from '@src/components/MediaPages/TVEpisodesListComponent'
import SeasonPageSkeleton from '@src/components/MediaPages/details/SeasonPageSkeleton'

/**
 * TVSeasonView Component
 *
 * @param {Object} props
 * @param {Object} props.media - Season media object
 * @param {Object} props.parsedParams - Parsed URL parameters
 * @param {string} [props.userId] - Current user id (for watch-history personalization)
 * @param {import('@src/lib/roles/libraryScope').LibraryAccess} props.access - The viewer's library access
 */
export default function TVSeasonView({ media, parsedParams, userId, access }) {
  const { mediaTitle, mediaSeason } = parsedParams

  return (
    // The boundary sits outside the padding wrapper, as in the episode view: the skeleton brings its own
    <Suspense fallback={<SeasonPageSkeleton />}>
      <div className="pt-16 w-full">
        <TVEpisodesListComponent
          showTitle={mediaTitle}
          originalTitle={media?.originalTitle}
          seasonNumber={mediaSeason}
          userId={userId}
          access={access}
        />
      </div>
    </Suspense>
  )
}
