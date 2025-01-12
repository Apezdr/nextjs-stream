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

// const PopupCard = dynamic(() => import('@src/components/MediaScroll/PopupCard'), {
//   ssr: false,
// })

const Card = ({
  title,
  itemId,
  mediaId,
  posterURL,
  posterBlurhash = null,
  backdrop,
  backdropBlurhash = null,
  videoURL,
  type,
  media,
  date,
  link,
  logo,
  listType,
  isExpanded,
  onExpand,
  onCollapse,
  isPeek = false,
  onCardClick,
  // tv
  seasonNumber = null,
  episodeNumber = null,
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

  // Detect if the device is a touch device
  useEffect(() => {
    const isTouch =
      'ontouchstart' in window || navigator.maxTouchPoints > 0 || navigator.msMaxTouchPoints > 0
    setIsTouchDevice(isTouch)
  }, [])

  const handleImageLoad = useCallback(({ target }) => {
    const { naturalWidth, naturalHeight } = target
    setImageDimensions({ width: naturalWidth, height: naturalHeight })
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

      const expandedWidth = Math.max(
        Math.min(Math.max(imageDimensions.width, collapsedWidth), MAX_EXPANDED_WIDTH),
        minimumWidth
      )

      let adjustedLeft = left

      const isMobile = window.innerWidth < 640

      if (isMobile) {
        adjustedLeft = window.scrollX + (window.innerWidth - expandedWidth) / 2
        adjustedLeft = Math.max(window.scrollX + 20, adjustedLeft)
      } else {
        const GAP = 20
        const rightEdge = adjustedLeft + expandedWidth
        const viewportRightEdge = window.scrollX + window.innerWidth

        if (rightEdge > viewportRightEdge - GAP) {
          adjustedLeft = Math.max(window.scrollX + GAP, viewportRightEdge - expandedWidth - GAP)
        }

        if (adjustedLeft < window.scrollX + GAP) {
          adjustedLeft = window.scrollX + GAP
        }
      }

      setImagePosition({
        top,
        left: adjustedLeft,
        width,
        height,
        expandedWidth,
      })
    }
  }, [collapsedWidth, imageDimensions.width, MAX_EXPANDED_WIDTH])

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
    const apiEndpoint = buildURL(
      type === 'tv'
        ? `/api/authenticated/media?mediaId=${mediaId}&mediaType=${type}&season=${seasonNumber}&episode=${episodeNumber}&card=true`
        : `/api/authenticated/media?mediaId=${mediaId}&mediaType=${type}&card=true`
    )
    if (isAnimating || isExpanded || isTouchDevice) return
    preload(apiEndpoint, fetcher)
    hoverTimeoutRef.current = setTimeout(() => {
      handleExpand()
    }, 1000)
  }, [isAnimating, isExpanded, handleExpand, isTouchDevice, mediaId, seasonNumber, episodeNumber, type])

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
    const handleResize = debounce(() => setCollapsedWidth(getCollapsedWidth()), 200)
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
  }, [showPortal, imageDimensions.width, calculateImagePosition])

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
        <div className="relative h-72 mx-auto transition-all duration-300 ease-in-out">
          <button className="block w-full h-full">
            <div className="relative w-full h-full">
              {logo && (
                <RetryImage
                  quality={50}
                  fill
                  src={logo}
                  alt={`${title} Logo`}
                  className="absolute z-20 !top-[67%] max-w-[70%] mx-auto max-h-14 inset-0 object-contain"
                  loading="lazy"
                  sizes="(max-width: 640px) 128px, (max-width: 1024px) 144px, 192px"
                />
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
                quality={50}
                fill
                src={posterURL}
                placeholder={posterBlurhash ? 'blur' : 'empty'}
                blurDataURL={posterBlurhash ? `data:image/png;base64,${posterBlurhash}` : undefined}
                alt={title}
                className={classNames(
                  'rounded-lg shadow-xl transition-opacity duration-300 object-cover',
                  'mx-auto relative',
                  'opacity-60 group-hover:opacity-100'
                )}
                loading="lazy"
                onLoad={handleImageLoad}
                onError={handleImageError}
              />
              {imageError && (
                <div className="absolute inset-0 flex items-center justify-center bg-gray-200">
                  <span className="text-red-500">Image failed to load</span>
                </div>
              )}
            </div>
          </button>
        </div>

        {/* Title and Date */}
        <div className="mt-2 text-center w-full">
          <div className="text-sm truncate" title={title}>
            {title}
          </div>
          {date && (
            <>
              <div className="text-xs text-gray-200">Last Watched:</div>
              <div className="text-[10px] text-gray-200 truncate">{date}</div>
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
            seasonNumber={seasonNumber}
            episodeNumber={episodeNumber}
            date={date}
            link={link}
            type={type}
            logo={logo}
            mediaId={mediaId}
            media={media}
            posterURL={posterURL}
            posterBlurhash={posterBlurhash}
            backdrop={backdrop}
            backdropBlurhash={backdropBlurhash}
            videoURL={videoURL}
            handleCollapse={handleCollapse}
            handlePortalMouseEnter={handlePortalMouseEnter}
            handlePortalMouseLeave={handlePortalMouseLeave}
            isTouchDevice={isTouchDevice}
          />,
          document.body
        )}
    </Fragment>
  )
}

Card.displayName = 'HorizontalScrollCard'

export default Card
