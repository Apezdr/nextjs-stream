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
import Loading from '@src/app/loading'

/**
 * @param {Object} props
 * @param {Object} props.parsedParams - Parsed URL parameters (mediaTitle is already decoded)
 * @param {Object|null} [props.media] - The show document, when the route fetched it
 * @param {string|null} [props.userId] - The viewer, for next-up and season status
 */
export default function TVShowView({ parsedParams, media = null, userId = null }) {
  return (
    <div className="pt-16 w-full">
      <Suspense fallback={<Loading />}>
        <TVShowSeasonsList showTitle={parsedParams.mediaTitle} show={media} userId={userId} />
      </Suspense>
    </div>
  )
}
