'use client'

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
 */
const CastSection = ({ cast }) => {
  // Don't render if no cast data
  if (!cast || Object.keys(cast).length === 0) {
    return null
  }

  // Calculate if we need the gradient overlay
  const castArray = Array.isArray(cast) ? cast : Object.values(cast)
  const showGradient = castArray.length > 16

  return (
    <div className="p-4 relative h-[31rem]">
      <h2 className="text-2xl text-gray-900 font-bold mb-4">Starring:</h2>

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