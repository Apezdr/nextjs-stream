'use client'

import Link from 'next/link'
import VirtualizedCastGrid from '../VirtualizedCastGrid'

/**
 * CastSection Component
 * 
 * Displays the cast members in a virtualized grid.
 * This component is designed to be Suspense-ready for future React 19 streaming enhancements.
 * 
 * Future Enhancement:
 * - Can be wrapped in <Suspense> to stream cast data separately from main content
 * - Will allow showing title/video instantly while cast data loads in background
 * 
 * @param {Object} props - Component props
 * @param {Object|Array} props.cast - Cast data (object or array of cast members)
 * @param {number} [props.castCount] - How many people the title has; /media sends the first 24
 * @param {string|null} [props.href] - The title page's cast, for "See all N" when there are more
 * @param {Function} [props.onNavigate] - Collapses the popup as the link navigates
 */
const CastSection = ({ cast, castCount, href = null, onNavigate }) => {
  // Don't render if no cast data
  if (!cast || Object.keys(cast).length === 0) {
    return null
  }

  // Calculate if we need the gradient overlay
  const castArray = Array.isArray(cast) ? cast : Object.values(cast)
  const showGradient = castArray.length > 16
  const more = href && castCount > castArray.length ? castCount : null

  return (
    <div className="p-4 relative h-[31rem]">
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <h2 className="text-2xl text-gray-900 font-bold">Starring:</h2>
        {more ? (
          <Link
            href={href}
            onClick={onNavigate}
            className="rounded text-sm font-medium text-blue-600 hover:text-blue-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
          >
            See all {more}
          </Link>
        ) : null}
      </div>

      {/* Virtualized Cast Grid */}
      <VirtualizedCastGrid cast={cast} />

      {/* Gradient Overlay for long lists */}
      {showGradient && (
        <div className="absolute bottom-0 left-0 w-full h-32 bg-gradient-to-t from-white to-transparent pointer-events-none"></div>
      )}
    </div>
  )
}

export default CastSection