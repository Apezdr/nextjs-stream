'use client'

import { useState, useRef, useEffect, useCallback, Suspense, Fragment } from 'react'
import { debounce } from 'lodash'
import Image from 'next/image'
import { buildURL, classNames, fetcher } from '@src/utils'
import { createPortal } from 'react-dom'
import dynamic from 'next/dynamic'
import { preload } from 'swr'
import RetryImage from '@components/RetryImage'
import PopupCard from './PopupCard'

const Card = ({
  title,
  showTitleFormatted, // Used for TV Episode titles
  itemId,
  mediaId,
  posterURL,
  posterBlurhash = null,
  backdrop,
  backdropBlurhash = null,
  videoURL,
  type,
  media,
  // Date fields (old and new)
  date,
  lastWatchedDate,
  addedDate,
  releaseDate,
  // Support for new blurhash structure
  blurhash = null,
  link,
  logo,
  listType,
  isExpanded,
  onExpand,
  onCollapse,
  isPeek = false,
  onCardClick,
  // tv
  showId = null,
  showTmdbId = null,
  seasonNumber = null,
  episodeNumber = null,
  // Availability status (for playlist items)
  isAvailable = true,
  comingSoon = false,
  comingSoonDate = null,
  metadata = null,
}) => {
  const [imageDimensions, setImageDimensions] = useState({
    width: 0,
    height: 0,
  })
  const [showPortal, setShowPortal] = useState(false)
  const [imagePosition, setImagePosition] = useState({
    top: 0,
    left: 0,
    width: 0,
    height: 0,
  })
  const [imageError, setImageError] = useState(false)
  const [isAnimating, setIsAnimating] = useState(false)
  const [isMouseOverCard, setIsMouseOverCard] = useState(false)
  const [isMouseOverPortal, setIsMouseOverPortal] = useState(false)
  const [MAX_EXPANDED_WIDTH, setMaxExpandedWidth] = useState(600)
  const [collapsedWidth, setCollapsedWidth] = useState(() => getCollapsedWidth())
  const [isTouchDevice, setIsTouchDevice] = useState(false)

  const cardRef = useRef(null)
  const imageRef = useRef(null)
  const hoverTimeoutRef = useRef(null)

  const isHovered = isMouseOverCard || isMouseOverPortal

  // Shared date handling logic for both Card and PopupCard
  const getDateInfo = useCallback(() => {
    // For unavailable content, show release status first
    if (isAvailable === false) {
      const itemReleaseDate = metadata?.release_date || metadata?.first_air_date || releaseDate;
      if (itemReleaseDate) {
        const releaseDateObj = new Date(itemReleaseDate);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        releaseDateObj.setHours(0, 0, 0, 0);
        
        const isUnreleased = releaseDateObj > today || comingSoon;
        const formattedDate = releaseDateObj.toLocaleDateString('en-US', {
          month: '2-digit',
          day: '2-digit',
          year: 'numeric'
        });
        
        return {
          label: isUnreleased ? "Releasing" : "Released",
          value: formattedDate,
          color: isUnreleased ? "text-blue-300" : "text-orange-300",
          popupColor: isUnreleased ? "text-blue-600" : "text-orange-600",
          bgColor: isUnreleased ? 'bg-blue-100' : 'bg-orange-100',
          textColor: isUnreleased ? 'text-blue-800' : 'text-orange-800',
          borderColor: isUnreleased ? 'border-blue-200' : 'border-orange-200',
          isReleaseStatus: true
        };
      }
    }
    
    // Standard date priority for available content
    if (lastWatchedDate) {
      return {
        label: "Last Watched",
        value: lastWatchedDate,
        color: "text-blue-300",
        popupColor: "text-blue-600",
        isReleaseStatus: false
      };
    } else if (addedDate) {
      return {
        label: "Added",
        value: addedDate,
        color: "text-green-300",
        popupColor: "text-green-600",
        isReleaseStatus: false
      };
    } else if (releaseDate) {
      return {
        label: "Released",
        value: releaseDate,
        color: "text-yellow-300",
        popupColor: "text-yellow-600",
        isReleaseStatus: false
      };
    } else if (date) {
      return {
        label: "Date",
        value: date,
        color: "text-gray-300",
        popupColor: "text-gray-600",
        isReleaseStatus: false
      };
    }
    return null;
  }, [isAvailable, metadata, releaseDate, comingSoon, lastWatchedDate, addedDate, date]);

  const dateInfo = getDateInfo();

  // Get effective blurhash from either new or legacy structure
  const effectivePosterBlurhash = blurhash?.poster || posterBlurhash
  
  // Detect image type: TV episodes have thumbnails (16:9), others have posters (2:3)
  const isEpisodeThumbnail = seasonNumber && episodeNumber
  
  // Calculate image dimensions based on container width
  // Container dimensions remain static for layout consistency
  const imageHeight = 288
  const imageWidth = collapsedWidth
  
  // Calculate optimal dimensions for Next.js Image optimization
  let optimizedWidth, optimizedHeight
  if (isEpisodeThumbnail) {
    // Episode thumbnails: 16:9 aspect ratio
    // For a 288px height container, optimal 16:9 image width would be ~512px
    optimizedHeight = 288
    optimizedWidth = Math.round(288 * (16 / 9)) // 512px
  } else {
    // Standard posters: 2:3 aspect ratio
    // Use container dimensions for optimization
    optimizedHeight = imageHeight
    optimizedWidth = imageWidth
  }
  
  // Detect if the device is a touch device
  useEffect(() => {
    const isTouch =
      'ontouchstart' in window || navigator.maxTouchPoints > 0 || navigator.msMaxTouchPoints > 0
    setIsTouchDevice(isTouch)
  }, [])

  const handleImageLoad = useCallback(({ target }) => {
    const { naturalWidth, naturalHeight } = target
    // Store natural dimensions for popup (high quality - these are now the original dimensions)
    setImageDimensions({ width: naturalWidth, height: naturalHeight })
    // Store rendered dimensions for position calculations
    setImagePosition({ width: naturalWidth, height: naturalHeight })
  }, [])

  const handleImageError = useCallback(() => {
    setImageError(true)
  }, [])

  const calculateImagePosition = useCallback(() => {
    if (imageRef.current) {
      const rect = imageRef.current.getBoundingClientRect()
      const top = rect.top + window.scrollY
      const left = rect.left + window.scrollX
      const width = rect.width
      const height = rect.height

      const minimumWidth = 300
      
      // Calculate 16:9 aspect ratio dimensions for popup (ideal for backdrop/video content)
      const aspectRatio = 16 / 9
      const isMobile = window.innerWidth < 640
      
      // Base popup width on available screen space, not poster dimensions
      let popupWidth
      if (isMobile) {
        popupWidth = Math.min(window.innerWidth - 40, MAX_EXPANDED_WIDTH)
      } else {
        popupWidth = Math.min(MAX_EXPANDED_WIDTH, window.innerWidth * 0.6)
      }
      
      // Ensure minimum width
      popupWidth = Math.max(popupWidth, minimumWidth)
      
      // Calculate height based on 16:9 aspect ratio
      const popupHeight = popupWidth / aspectRatio

      let adjustedLeft = left

      if (isMobile) {
        adjustedLeft = window.scrollX + (window.innerWidth - popupWidth) / 2
        adjustedLeft = Math.max(window.scrollX + 20, adjustedLeft)
      } else {
        const GAP = 20
        const rightEdge = adjustedLeft + popupWidth
        const viewportRightEdge = window.scrollX + window.innerWidth

        if (rightEdge > viewportRightEdge - GAP) {
          adjustedLeft = Math.max(window.scrollX + GAP, viewportRightEdge - popupWidth - GAP)
        }

        if (adjustedLeft < window.scrollX + GAP) {
          adjustedLeft = window.scrollX + GAP
        }
      }

      setImagePosition({
        top,
        left: adjustedLeft,
        width,
        height: popupHeight, // Use calculated 16:9 height
        expandedWidth: popupWidth, // Use calculated 16:9 width
      })
    }
  }, [collapsedWidth, MAX_EXPANDED_WIDTH])

  const handleExpand = useCallback(() => {
    if (isAnimating) return
    if (isPeek) return
    setIsAnimating(true)
    onExpand(itemId)
    calculateImagePosition()
    setShowPortal(true)
  }, [isAnimating, onExpand, itemId, calculateImagePosition])

  const handleCollapse = useCallback(() => {
    if (isAnimating) return
    setShowPortal(false)
    if (onCollapse) {
      onCollapse()
    }
  }, [isAnimating, onCollapse])

  const handleMouseEnter = useCallback(() => {
    if (isAnimating || isExpanded || isTouchDevice) return
    
    // Only preload API data for available items (in library)
    // For TMDB-only items, PopupCard will use metadata directly
    if (isAvailable === true) {
      const apiEndpoint = buildURL(
        type === 'tv'
          ? `/api/authenticated/media?mediaId=${mediaId}&mediaType=${type}&season=${seasonNumber}&episode=${episodeNumber}&card=true`
          : `/api/authenticated/media?mediaId=${mediaId}&mediaType=${type}&card=true`
      )
      preload(apiEndpoint, fetcher)
    } else if (process.env.NODE_ENV === 'development') {
      console.log(`[Card] Skipping API preload for unavailable item: ${title} (isAvailable: ${isAvailable})`)
    }
    
    hoverTimeoutRef.current = setTimeout(() => {
      handleExpand()
    }, 1000)
  }, [isAnimating, isExpanded, handleExpand, isTouchDevice, mediaId, seasonNumber, episodeNumber, type, isAvailable, title])

  const handleMouseLeave = useCallback(() => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current)
      hoverTimeoutRef.current = null
    }
    if (!isHovered && showPortal && !isTouchDevice) {
      handleCollapse()
    }
  }, [handleCollapse, isHovered, showPortal, isTouchDevice])

  const handleCardMouseEnter = useCallback(() => {
    setIsMouseOverCard(true)
    handleMouseEnter()
  }, [handleMouseEnter])

  const handleCardMouseLeave = useCallback(() => {
    setIsMouseOverCard(false)
    handleMouseLeave()
  }, [handleMouseLeave])

  const handlePortalMouseEnter = useCallback(() => {
    setIsMouseOverPortal(true)
  }, [])

  const handlePortalMouseLeave = useCallback(() => {
    setIsMouseOverPortal(false)
    handleMouseLeave()
  }, [handleMouseLeave])

  const handleCardClick = useCallback(() => {
    if (onCardClick) {
      onCardClick()
    } else {
      handleExpand()
    }
  }, [onCardClick, handleExpand])

  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        handleExpand()
      }
    },
    [handleExpand]
  )

  // Maximum width to prevent oversized expansions
  useEffect(() => {
    const updateMaxExpandedWidth = () => {
      setMaxExpandedWidth(Math.min(600, window.innerWidth - 40))
    }
    updateMaxExpandedWidth()
    window.addEventListener('resize', updateMaxExpandedWidth)
    return () => {
      window.removeEventListener('resize', updateMaxExpandedWidth)
    }
  }, [])

  function getCollapsedWidth() {
    const width = window.innerWidth
    if (width < 640) return 128
    if (width < 1024) return 144
    return 192
  }

  useEffect(() => {
    const handleResize = debounce(() => {
      const newWidth = getCollapsedWidth()
      setCollapsedWidth(newWidth)
    }, 200)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const containerWidth = collapsedWidth

  useEffect(() => {
    if (isAnimating) {
      const timeout = setTimeout(() => {
        setIsAnimating(false)
      }, 300)
      return () => clearTimeout(timeout)
    }
  }, [isAnimating])

  useEffect(() => {
    if (!isTouchDevice && !isHovered && showPortal) {
      handleCollapse()
    }
  }, [handleCollapse, isHovered, showPortal, isTouchDevice])

  useEffect(() => {
    if (!showPortal) return

    const handleScroll = debounce(() => {
      calculateImagePosition()
    }, 100)

    window.addEventListener('scroll', handleScroll)
    window.addEventListener('resize', handleScroll)

    return () => {
      window.removeEventListener('scroll', handleScroll)
      window.removeEventListener('resize', handleScroll)
      handleScroll.cancel()
    }
  }, [showPortal, calculateImagePosition])

  useEffect(() => {
    if (showPortal) {
      calculateImagePosition()
    }
  }, [showPortal, calculateImagePosition])

  return (
    <Fragment>
      <div
        ref={cardRef}
        className={classNames(
          'card',
          isPeek ? 'opacity-50 scale-95 cursor-default' : 'cursor-pointer',
          'group relative flex-shrink-0 cursor-pointer transition-all duration-300 ease-in-out'
        )}
        style={{ width: `${containerWidth}px` }}
        onMouseEnter={handleCardMouseEnter}
        onMouseLeave={handleCardMouseLeave}
        onClick={handleCardClick}
        onFocus={handleExpand}
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
        onKeyDown={handleKeyDown}
      >
        <div 
          className="relative mx-auto transition-all duration-300 ease-in-out"
          style={{ width: `${imageWidth}px`, height: `${imageHeight}px` }}
        >
          <button className="block w-full h-full">
            <div className="relative w-full h-full">
              {logo && (
                <RetryImage
                  quality={50}
                  width={Math.floor(imageWidth * 0.7)}
                  height={56}
                  src={logo}
                  alt={`${title} Logo`}
                  className="absolute z-20 top-[67%] left-1/2 transform -translate-x-1/2 max-w-[70%] max-h-14 object-contain"
                  loading="lazy"
                  sizes="(max-width: 640px) 90px, (max-width: 1024px) 101px, 134px"
                />
              )}
              {/* Status Badges */}
              {!isAvailable && (
                <div className="absolute z-20 top-2 right-2">
                  {comingSoon ? (
                    <div className="bg-blue-600 text-white text-xs px-2 py-1 rounded-md shadow-lg flex items-center gap-1">
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span>Coming Soon</span>
                      {comingSoonDate && (
                        <span className="ml-1 font-medium">
                          {new Date(comingSoonDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                        </span>
                      )}
                    </div>
                  ) : (
                    <div className="bg-gray-600 bg-opacity-90 text-white text-xs px-2 py-1 rounded-md shadow-lg flex items-center gap-1">
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                      </svg>
                      <span>Not Available</span>
                    </div>
                  )}
                </div>
              )}
              
              {seasonNumber && (
                <div className="absolute z-20 bottom-2 left-2 right-2">
                  <div className="bg-gray-200 bg-opacity-20 rounded-xl flex flex-row gap-1 px-2 py-1 justify-center">
                    <span className="text-xs text-slate-800">S{seasonNumber}</span>
                    <span className="text-xs">|</span>
                    <span className="text-xs font-bold">E{episodeNumber}</span>
                  </div>
                </div>
              )}
              <RetryImage
                ref={imageRef}
                quality={80}
                width={optimizedWidth}
                height={optimizedHeight}
                src={posterURL}
                placeholder={effectivePosterBlurhash ? 'blur' : 'empty'}
                blurDataURL={effectivePosterBlurhash ? `data:image/png;base64,${effectivePosterBlurhash}` : undefined}
                alt={title}
                className={classNames(
                  'rounded-lg shadow-xl transition-opacity duration-300 object-cover',
                  // Slightly dim unavailable items
                  isAvailable
                    ? 'opacity-60 group-hover:opacity-100'
                    : 'opacity-40 group-hover:opacity-70'
                )}
                loading="lazy"
                sizes={
                  isEpisodeThumbnail
                    ? "512px"  // Fixed size for 16:9 thumbnails
                    : "(max-width: 640px) 128px, (max-width: 1024px) 144px, 192px"  // Responsive for posters
                }
                onLoad={handleImageLoad}
                onError={handleImageError}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
              {imageError && (
                <div 
                  className="absolute inset-0 flex items-center justify-center bg-gray-200 rounded-lg"
                  style={{ width: `${imageWidth}px`, height: `${imageHeight}px` }}
                >
                  <span className="text-red-500 text-xs text-center px-2">Image failed to load</span>
                </div>
              )}
            </div>
          </button>
        </div>

        {/* Title and Date - Enhanced with release status */}
        <div className="mt-2 text-center w-full">
          <div className="text-sm truncate" title={title}>
            {title}
          </div>
          {/* Display date with enhanced labels including release status */}
          {dateInfo && (
            <>
              <div className={classNames("text-xs font-medium", dateInfo.color)}>
                {dateInfo.label}:
              </div>
              <div className="text-[10px] text-white truncate">{dateInfo.value}</div>
            </>
          )}
        </div>
      </div>
      {/* React Portal for Expanded View */}
      {isExpanded &&
        showPortal &&
        createPortal(
          <PopupCard
            imageDimensions={imageDimensions}
            imagePosition={imagePosition}
            title={title}
            showTitleFormatted={showTitleFormatted}
            seasonNumber={seasonNumber}
            episodeNumber={episodeNumber}
            // Pass all date types for the popup
            lastWatchedDate={lastWatchedDate}
            addedDate={addedDate}
            releaseDate={releaseDate}
            date={date} // For backward compatibility
            link={link}
            type={type}
            logo={logo}
            mediaId={mediaId}
            showId={showId}
            showTmdbId={showTmdbId}
            media={media}
            posterURL={posterURL}
            posterBlurhash={effectivePosterBlurhash}
            backdrop={backdrop}
            backdropBlurhash={blurhash?.backdrop || backdropBlurhash}
            videoURL={videoURL}
            handleCollapse={handleCollapse}
            handlePortalMouseEnter={handlePortalMouseEnter}
            handlePortalMouseLeave={handlePortalMouseLeave}
            isTouchDevice={isTouchDevice}
            blurhash={blurhash}
            // Availability flags and metadata for TMDB-only items
            isAvailable={isAvailable}
            comingSoon={comingSoon}
            comingSoonDate={comingSoonDate}
            metadata={metadata}
            // Pass the shared date info
            dateInfo={dateInfo}
          />,
          document.body
        )}
    </Fragment>
  )
}

Card.displayName = 'HorizontalScrollCard'

export default Card
