/**
 * TV Show View
 *
 * The show info page: next-up episode, seasons, cast and show facts.
 * Route: /list/tv/{show}
 *
 * The route's cached subtree hands down the show it already fetched and the
 * viewer's id (which is part of that cache entry's key); both are optional
 * so the catch-all route can still render this view from the title alone.
 */

import { Suspense } from 'react'
import TVShowSeasonsList from '@src/components/MediaPages/TVShowSeasonsListComponent'
import ShowPageSkeleton from '@src/components/MediaPages/details/ShowPageSkeleton'

/**
 * @param {Object} props
 * @param {Object} props.parsedParams - Parsed URL parameters (mediaTitle is already decoded)
 * @param {Object|null} [props.media] - The show document, when the route fetched it
 * @param {string|null} [props.userId] - The viewer, for next-up and season status
 */
export default function TVShowView({ parsedParams, media = null, userId = null }) {
  return (
    // The boundary sits outside the padding wrapper, as in the season and episode views: the skeleton brings its own
    <Suspense fallback={<ShowPageSkeleton />}>
      <div className="pt-16 w-full">
        <TVShowSeasonsList showTitle={parsedParams.mediaTitle} show={media} userId={userId} />
      </div>
    </Suspense>
  )
}
