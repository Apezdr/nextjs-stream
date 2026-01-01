/**
 * Not Found Header Component
 * 
 * Shows context header with show information for season/episode not found errors.
 * Displays a compact show info chip with poster thumbnail and metadata.
 */

import Image from 'next/image'
import Link from 'next/link'

/**
 * NotFoundHeader - Display show context for missing season/episode
 * 
 * @param {Object} props
 * @param {Object} props.showData - TV show data with metadata
 * @param {string} props.mediaTitle - URL-encoded show title for links
 */
export default function NotFoundHeader({ showData, mediaTitle }) {
  if (!showData) return null
  
  return (
    <div className="mb-6 flex items-center justify-center">
      <div className="flex items-center gap-3 px-4 py-2 bg-black/20 backdrop-blur rounded-lg border border-white/10">
        {/* Tiny poster thumbnail */}
        <Image
          src={showData.posterURL || '/sorry-image-not-available.jpg'}
          alt={showData.title}
          width={32}
          height={48}
          className="w-8 h-12 object-cover rounded"
        />
        
        {/* Show info */}
        <div className="flex items-center gap-3">
          <div className="text-left">
            <h3 className="text-white font-medium text-sm">
              {showData.title}
              {showData.metadata?.first_air_date && (
                <span className="text-white/60 ml-1">
                  ({new Date(showData.metadata.first_air_date).getFullYear()})
                </span>
              )}
            </h3>
          </div>
          
          {/* Status chip */}
          {showData.metadata?.status && (
            <span className="px-2 py-1 text-xs rounded-full bg-white/10 text-white/80 border border-white/20">
              {showData.metadata.status}
            </span>
          )}
          
          {/* View show page link */}
          <Link
            href={`/list/tv/${mediaTitle}`}
            className="text-xs text-blue-400 hover:text-blue-300 transition-colors flex items-center gap-1"
          >
            View show page
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        </div>
      </div>
    </div>
  )
}