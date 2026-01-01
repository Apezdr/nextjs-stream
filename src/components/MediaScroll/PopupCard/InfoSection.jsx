'use client'

import Link from 'next/link'
import { motion } from 'framer-motion'
import { InformationCircleIcon } from '@heroicons/react/20/solid'
import { classNames, getFullImageUrl } from '@src/utils'
import WatchlistButton from '@components/WatchlistButton'
import Loading from '@src/app/loading'

/**
 * InfoSection Component
 * 
 * Handles the informational content of the PopupCard including:
 * - Title and episode information
 * - Breadcrumb navigation for TV shows
 * - Description text
 * - Date and release status information
 * - Action buttons (Watch Now, View Details, Watchlist)
 * 
 * @param {Object} props - Component props
 * @param {Object} props.data - Fetched media data
 * @param {boolean} props.isLoading - Whether data is still loading
 * @param {string} props.type - Media type ('movie' or 'tv')
 * @param {string} props.title - Media title
 * @param {string} props.showTitleFormatted - Formatted TV show title
 * @param {number} props.seasonNumber - Season number for TV shows
 * @param {number} props.episodeNumber - Episode number for TV shows
 * @param {string} props.link - Internal link for navigation
 * @param {string} props.mediaId - Media ID
 * @param {string} props.showId - Show ID for TV shows
 * @param {string} props.showTmdbId - TMDB ID for TV shows
 * @param {Object} props.metadata - TMDB metadata
 * @param {Object} props.dateInfo - Date information object
 * @param {boolean} props.hasVideo - Whether video is available
 * @param {string} props.videoURL - Video URL if available
 * @param {Function} props.handleNavigationWithLoading - Navigation handler with loading state
 */
const InfoSection = ({
  data,
  isLoading,
  type,
  title,
  showTitleFormatted,
  seasonNumber,
  episodeNumber,
  link,
  mediaId,
  showId,
  showTmdbId,
  metadata,
  dateInfo,
  hasVideo,
  videoURL,
  handleNavigationWithLoading,
}) => {
  const isTrailer = !data?.clipVideoURL && data?.trailer_url
  const hdr = data?.hdr || false
  
  // Use the shared dateInfo from Card component
  const displayDate = dateInfo
  
  // For release status banner, use dateInfo if it's a release status
  const releaseStatus = dateInfo?.isReleaseStatus ? dateInfo : null

  return (
    <div className="p-4">
      {/* Breadcrumb Navigation for TV Shows */}
      {type === 'tv' && title && (
        <div className="flex items-center text-sm text-gray-600 mb-2 flex-wrap">
          <Link
            href={`/list/${type}/${encodeURIComponent(title)}`}
            className="text-blue-600 hover:text-blue-800 hover:underline font-medium"
            onClick={(e) => handleNavigationWithLoading(e, `/list/${type}/${encodeURIComponent(title)}`)}
          >
            {title}
          </Link>
          
          {seasonNumber && (
            <>
              <span className="mx-1.5">/</span>
              <Link
                href={`/list/${type}/${encodeURIComponent(title)}/${seasonNumber}`}
                className="text-blue-600 hover:text-blue-800 hover:underline font-medium"
                onClick={(e) => handleNavigationWithLoading(e, `/list/${type}/${encodeURIComponent(title)}/${seasonNumber}`)}
              >
                Season {seasonNumber}
              </Link>
            </>
          )}
          
          {episodeNumber && (
            <>
              <span className="mx-1.5">/</span>
              <span className="text-gray-700 font-medium">
                Episode {episodeNumber}
              </span>
            </>
          )}
          
          {(hasVideo || videoURL) && (seasonNumber || episodeNumber) ? (
            <>
              <span className="relative ml-auto text-xs bg-yellow-400 text-black font-bold px-2 py-1 rounded-bl-md z-[50]">
                {isTrailer ? "TRAILER" : "CLIP"}
                {/* Show Youtube button if trailer */}
                {isTrailer && (
                  <Link href={data?.trailer_url} target='_blank' className="text-red-600 hover:text-red-800 text-xs font-bold ml-2 pl-2 border-l border-gray-800">
                    YouTube
                  </Link>
                )}
              </span>
            </>
          ) : null}
        </div>
      )}

      <div className="flex flex-row relative">
        {(hasVideo || videoURL) && (!seasonNumber || !episodeNumber) ? (
          <>
            <span className="absolute top-0 right-0 text-xs bg-yellow-400 text-black font-bold px-2 py-1 rounded-bl-md z-[50]">
              {isTrailer ? "TRAILER" : "CLIP"}
              {/* Show Youtube button if trailer */}
              {isTrailer && (
                <Link href={data?.trailer_url} target='_blank' className="text-red-600 hover:text-red-800 text-xs font-bold ml-2 pl-2 border-l border-gray-800">
                  YouTube
                </Link>
              )}
            </span>
          </>
        ) : null}
        <h2 className={classNames(
          "text-2xl text-gray-900 font-bold mb-2 w-[88%] overflow-hidden",
          "w-full mr-4",
          data?.seasonNumber || data?.episodeNumber ? "border-r-[1px] border-r-[#dfdfdf96]" : ""
        )}>{data?.title ?? showTitleFormatted ?? title}</h2>
        {(data?.seasonNumber || data?.episodeNumber) && (
          <motion.h2 className={classNames(
            "relative self-center text-2xl text-gray-700 font-bold mb-2"
            )}
            key="season-episode"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4 }}
          >
            {data?.seasonNumber ? `S${data?.seasonNumber}` : ''}
            {data?.episodeNumber ? `E${data?.episodeNumber}` : ''}
            {data?.seasonNumber || data?.episodeNumber ? ' ' : ''}
          </motion.h2>
        )}
      </div>

      {displayDate && (
        <div className="flex items-center mb-1 gap-1">
          <span className={classNames("text-sm font-medium", displayDate.popupColor)}>
            {displayDate.label}:
          </span>
          <span className="text-sm text-gray-800 font-medium">{displayDate.value}</span>
        </div>
      )}
      
      {/* Release Status Banner for unavailable content */}
      {releaseStatus && (
        <div className={classNames(
          'inline-flex items-center px-3 py-1 rounded-full text-sm font-medium border mb-3',
          releaseStatus.bgColor,
          releaseStatus.textColor,
          releaseStatus.borderColor
        )}>
          {releaseStatus.isUnreleased ? (
            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          ) : (
            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          )}
          {releaseStatus.label}
        </div>
      )}
      
      <div className="text-gray-500 mb-2">
        {isLoading ? <Loading fullscreenClasses={false} /> : data?.overview ?? data?.description ?? 'No description available.'}
      </div>

      <div className="flex flex-row gap-2">
        {/* Watch Now and View Details buttons - only for internal content with link */}
        {link && (
          <>
            {(type === 'tv' && seasonNumber && episodeNumber || type === 'movie') && (
              <Link
                href={`/list/${type}/${link}/play`}
                className={classNames(
                  'relative inline-flex items-center gap-2 opacity-80 hover:opacity-100 bg-slate-500 hover:bg-slate-600 text-white font-bold rounded-md px-4 py-2 mt-4'
                )}
                onClick={(e) => handleNavigationWithLoading(e, `/list/${type}/${link}/play`)}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className="w-5 h-5"
                >
                  <path
                    fillRule="evenodd"
                    d="M4.5 5.653c0-1.426 1.529-2.33 2.779-1.643l11.54 6.348c1.295.712 1.295 2.573 0 3.285L7.28 19.991c-1.25.687-2.779-.217-2.779-1.643V5.653z"
                    clipRule="evenodd"
                  />
                </svg>
                <span>Watch Now {hdr ? `in ${hdr}` : null}</span>
              </Link>
            )}
            <Link
              href={`/list/${type}/${link}`}
              className="h-12 mt-4 flex flex-row items-center self-center px-6 py-2 text-white bg-blue-600 rounded-full hover:bg-blue-700 transition"
              onClick={(e) => handleNavigationWithLoading(e, `/list/${type}/${link}`)}
            >
              <InformationCircleIcon className="size-6 mr-0 sm:mr-2" />
              <span className="hidden sm:inline">
                View Details
              </span>
            </Link>
          </>
        )}
        
        {/* Add WatchlistButton for both internal and TMDB-only content */}
        {(type === 'movie' || type === 'tv') && (mediaId || showId || showTmdbId || metadata?.id) && (
          <WatchlistButton
            mediaId={showId ?? mediaId}
            tmdbId={showTmdbId ?? data?.metadata?.id ?? metadata?.id}
            mediaType={type}
            title={episodeNumber ? title : (data?.title ?? title)}
            posterURL={data?.poster_path ? getFullImageUrl(data?.poster_path, 'w500') : data?.posterURL}
            className="h-12 mt-4 px-4 py-2 rounded-full"
          />
        )}
      </div>
    </div>
  )
}

export default InfoSection