/**
 * TV Show View
 * 
 * Displays list of seasons for a TV show.
 * Route: /list/tv/{show}
 */

import { Suspense } from 'react'
import TVShowSeasonsList from '@src/components/MediaPages/TVShowSeasonsListComponent'
import Loading from '@src/app/loading'

/**
 * TVShowView Component
 * 
 * @param {Object} props
 * @param {Object} props.parsedParams - Parsed URL parameters
 */
export default function TVShowView({ parsedParams }) {
  const { mediaTitle } = parsedParams
  
  return (
    <Suspense fallback={<Loading />}>
      <TVShowSeasonsList showTitle={mediaTitle} />
    </Suspense>
  )
}