'use client'

import { useState, useRef, useEffect, useCallback, Suspense, Fragment, useSyncExternalStore, useMemo, useEffectEvent } from 'react'
import { debounce } from 'lodash'
import Image from 'next/image'
import { buildURL, classNames, fetcher, buildNextOptimizedImageUrl } from '@src/utils'
import { createPortal, preload as preloadResource } from 'react-dom'
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
  
  // Helper function defined before usage
  const getCollapsedWidth = () => {
    const width = window.innerWidth
    if (width < 640) return 128
    if (width < 1024) return 144
    return 192
  }
  
  const [collapsedWidth, setCollapsedWidth] = useState(() => getCollapsedWidth())
  
  // Use useSyncExternalStore for SSR-safe touch device detection
  const isTouchDevice = useSyncExternalStore(
    () => () => {},
    () => 'ontouchstart' in window || navigator.maxTouchPoints > 0 || navigator.msMaxTouchPoints > 0,
    () => false
  )

  const cardRef = useRef(null)
  const imageRef = useRef(null)
  const hoverTimeoutRef = useRef(null)

  const isHovered = isMouseOverCard || isMouseOverPortal

  // Memoize expensive date calculations (React 19.2 optimization)
  const dateInfo = useMemo(() => {
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

  // Memoize image configuration (React 19.2 optimization)
  const imageConfig = useMemo(() => {
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

    return {
      effectivePosterBlurhash,
      isEpisodeThumbnail,
      imageHeight,
      imageWidth,
      optimizedWidth,
      optimizedHeight
    }
  }, [blurhash, posterBlurhash, seasonNumber, episodeNumber, collapsedWidth])

  // Destructure for easier access
  const { 
    effectivePosterBlurhash, 
    isEpisodeThumbnail, 
    imageHeight, 
    imageWidth, 
    optimizedWidth, 
    optimizedHeight 
  } = imageConfig
  
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
  }, [MAX_EXPANDED_WIDTH])

  const handleExpand = useCallback(() => {
    if (isAnimating) return
    if (isPeek) return
    setIsAnimating(true)
    onExpand(itemId)
    calculateImagePosition()
    setShowPortal(true)
  }, [isAnimating, isPeek, onExpand, itemId, calculateImagePosition])

  const handleCollapse = useCallback(() => {
    if (isAnimating) return
    setShowPortal(false)
    if (onCollapse) {
      onCollapse()
    }
  }, [isAnimating, onCollapse])

  const handleMouseEnter = useCallback(() => {
    if (isAnimating || isExpanded || isTouchDevice) return
    
    // React 19.2 & Next.js 16 optimizations: Strategic preloading
    if (isAvailable === true) {
      // SWR preload for API data
      const apiEndpoint = buildURL(
        type === 'tv'
          ? `/api/authenticated/media?mediaId=${mediaId}&mediaType=${type}&season=${seasonNumber}&episode=${episodeNumber}&card=true`
          : `/api/authenticated/media?mediaId=${mediaId}&mediaType=${type}&card=true`
      )
      preload(apiEndpoint, fetcher)
      
      // React 19 image preloading with Next.js optimized URLs (matches actual Image component requests)
      if (backdrop) {
        // Backdrop for popup - high resolution 16:9 image
        const optimizedBackdropUrl = buildNextOptimizedImageUrl(backdrop, 1920, 100)
        if (optimizedBackdropUrl) {
          preloadResource(optimizedBackdropUrl, { as: "image", fetchPriority: "high" })
        }
      }
      
      // Preload logo for better popup appearance - smaller size, lower quality
      if (logo) {
        const optimizedLogoUrl = buildNextOptimizedImageUrl(logo, 400, 50)
        if (optimizedLogoUrl) {
          preloadResource(optimizedLogoUrl, { as: "image" })
        }
      }
      
      // Preload poster with actual dimensions Next.js will request (accounting for device pixel ratio)
      if (posterURL && posterURL !== backdrop) {
        // Next.js applies device pixel ratio scaling, so actual requests are higher resolution
        // For episode thumbnails: Next.js requests w=1920&q=100 (not our calculated 512px)
        // For posters: Calculate based on largest responsive breakpoint with DPR scaling
        let preloadWidth, preloadQuality;
        
        if (isEpisodeThumbnail) {
          // Episode thumbnails: Next.js consistently requests 1920px width at 100% quality
          preloadWidth = 1920;
          preloadQuality = 100;
        } else {
          // Standard posters: Use largest responsive breakpoint (192px) * 3 for retina + margin
          preloadWidth = 576; // 192px * 3 for high DPR devices
          preloadQuality = 80;
        }
        
        const optimizedPosterUrl = buildNextOptimizedImageUrl(posterURL, preloadWidth, preloadQuality)
        if (optimizedPosterUrl) {
          preloadResource(optimizedPosterUrl, { as: "image" })
        }
      }
    } else if (process.env.NODE_ENV === 'development') {
      console.log(`[Card] Skipping API preload for unavailable item: ${title} (isAvailable: ${isAvailable})`)
    }
    
    hoverTimeoutRef.current = setTimeout(() => {
      handleExpand()
    }, 1000)
  }, [isAnimating, isExpanded, handleExpand, isTouchDevice, mediaId, seasonNumber, episodeNumber, type, isAvailable, title, backdrop, logo, posterURL, isEpisodeThumbnail, optimizedWidth])

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

  // React 19.2 useEffectEvent: Non-reactive window resize logic
  const updateMaxExpandedWidth = useEffectEvent(() => {
    setMaxExpandedWidth(Math.min(600, window.innerWidth - 40))
  })

  const updateCollapsedWidth = useEffectEvent(() => {
    const newWidth = getCollapsedWidth()
    setCollapsedWidth(newWidth)
  })

  // Non-reactive scroll position calculation
  const updateImagePosition = useEffectEvent(() => {
    calculateImagePosition()
  })

  // Simplified effects using useEffectEvent (React 19.2 optimization)
  useEffect(() => {
    updateMaxExpandedWidth()
    window.addEventListener('resize', updateMaxExpandedWidth)
    return () => {
      window.removeEventListener('resize', updateMaxExpandedWidth)
    }
  }, [])

  useEffect(() => {
    const handleResize = debounce(updateCollapsedWidth, 200)
    window.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('resize', handleResize)
      handleResize.cancel()
    }
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

  // Use a ref to track previous hover state to avoid setState in effect
  const prevIsHoveredRef = useRef(isHovered)
  
  useEffect(() => {
    // Only call handleCollapse when transitioning from hovered to not hovered
    // This is intentional - we're synchronizing with user interaction state
    if (!isTouchDevice && showPortal && prevIsHoveredRef.current && !isHovered) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      handleCollapse()
    }
    prevIsHoveredRef.current = isHovered
  }, [isHovered, showPortal, isTouchDevice, handleCollapse])

  useEffect(() => {
    if (!showPortal) return

    const handleScroll = debounce(updateImagePosition, 100)

    window.addEventListener('scroll', handleScroll)
    window.addEventListener('resize', handleScroll)

    return () => {
      window.removeEventListener('scroll', handleScroll)
      window.removeEventListener('resize', handleScroll)
      handleScroll.cancel()
    }
  }, [showPortal])

  useEffect(() => {
    if (showPortal) {
      updateImagePosition()
    }
  }, [showPortal])

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
