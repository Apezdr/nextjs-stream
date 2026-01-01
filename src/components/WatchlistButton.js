'use client'

import { useState, useCallback, useEffect } from 'react'
import { HeartIcon } from '@heroicons/react/24/outline'
import { HeartIcon as HeartIconSolid } from '@heroicons/react/24/solid'
import { toast } from 'react-toastify'
import { useSession } from 'next-auth/react'
import { LoadingDots } from '@src/app/loading'
import { AnimatePresence, motion } from 'framer-motion'

export default function WatchlistButton({
  mediaId,
  tmdbId,
  mediaType,
  title,
  posterURL,
  size = 'md',
  variant = 'default',
  className = '',
  onStatusChange
}) {
  const { data: session, status } = useSession()
  const [inWatchlist, setInWatchlist] = useState(false)
  const [checking, setChecking] = useState(true)
  const [toggling, setToggling] = useState(false)

  // Build query params helper
  const buildParams = useCallback((action) => {
    const params = new URLSearchParams()
    params.set('action', action)
    if (mediaId) params.set('mediaId', mediaId)
    if (tmdbId) params.set('tmdbId', tmdbId.toString())
    return params.toString()
  }, [mediaId, tmdbId])

  // Fetch status
  const fetchStatus = useCallback(async () => {
    if (status !== 'authenticated') return

    setChecking(true)
    try {
      const query = buildParams('status')
      const res = await fetch(`/api/authenticated/watchlist?${query}`, {
        method: 'GET',
        cache: 'no-store',
        credentials: 'include',
        headers: { Accept: 'application/json' }
      })
      if (!res.ok) throw new Error(`Status ${res.status}`)
      const { inWatchlist: flag } = await res.json()
      setInWatchlist(!!flag)
    } catch (err) {
      console.error('checkWatchlistStatus error', err)
    } finally {
      setChecking(false)
    }
  }, [status, buildParams])

  useEffect(() => {
    if (status === 'authenticated') fetchStatus()
    else if (status === 'unauthenticated') setChecking(false)
  }, [status, fetchStatus])

  // Toggle add/remove
  const toggle = useCallback(async () => {
    if (checking || toggling || status !== 'authenticated') {
      if (status !== 'authenticated') toast.error('Please sign in')
      return
    }

    setToggling(true)
    try {
      const body = { mediaType, title }
      // Prioritize mediaId for internal media, only use tmdbId if no mediaId
      if (mediaId) {
        body.mediaId = mediaId
      } else if (tmdbId) {
        body.tmdbId = tmdbId
      }
      
      // Include poster URL if available for better watchlist display
      if (posterURL) {
        body.posterURL = posterURL
      }

      console.log('Toggling watchlist:', body)
      const res = await fetch(`/api/authenticated/watchlist?${buildParams('toggle')}`, {
        method: 'POST',
        cache: 'no-store',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || res.statusText)
      }
      const { action: result, item } = await res.json()
      const added = result === 'added'
      setInWatchlist(added)
      onStatusChange?.(added, item)

      toast[added ? 'success' : 'info'](
        <div className="flex flex-col">
          <span className="font-medium">
            {added ? 'Added to Watchlist' : 'Removed from Watchlist'}
          </span>
          <span className="text-xs opacity-75">{title}</span>
        </div>
      )
    } catch (err) {
      console.error('toggleWatchlist error', err)
      toast.error(err.message || 'Something went wrong')
    } finally {
      setToggling(false)
    }
  }, [
    checking,
    toggling,
    status,
    mediaType,
    title,
    mediaId,
    tmdbId,
    posterURL,
    buildParams,
    onStatusChange
  ])

  // Animation variants for text transitions
  const textVariants = {
    initial: { opacity: 0, y: 10, scale: 0.95 },
    animate: {
      opacity: 1,
      y: 0,
      scale: 1,
      transition: {
        duration: 0.3,
        ease: [0.4, 0, 0.2, 1]
      }
    },
    exit: {
      opacity: 0,
      y: -10,
      scale: 0.95,
      transition: {
        duration: 0.2,
        ease: [0.4, 0, 0.2, 1]
      }
    }
  }

  // Loading animation variants
  const loadingVariants = {
    animate: {
      scale: [1, 1.1, 1],
      opacity: [0.7, 1, 0.7],
      transition: {
        duration: 1.5,
        repeat: Infinity,
        ease: "easeInOut"
      }
    }
  }

  // Icon animation variants
  const iconVariants = {
    initial: { scale: 1 },
    hover: { scale: 1.1 },
    tap: { scale: 0.95 },
    toggling: {
      rotate: [0, 10, -10, 0],
      transition: {
        duration: 0.6,
        repeat: Infinity,
        ease: "easeInOut"
      }
    }
  }

  // While loading session or status
  if (status === 'loading' || checking) {
    return (
      <div className={`inline-flex items-center justify-center ${className}`}>
        <motion.div
          variants={loadingVariants}
          animate="animate"
        >
          <HeartIcon className="w-5 h-5 text-white opacity-20" />
        </motion.div>
        <div className='absolute'><LoadingDots dotClasses="h-[0.3rem] w-[0.3rem]" color="bg-gray-200" /></div>
      </div>
    )
  }
  if (status === 'unauthenticated') return null

  // Pick icon/text
  const Icon = inWatchlist ? HeartIconSolid : HeartIcon
  const label = inWatchlist ? 'In Watchlist' : 'Add to Watchlist'
  const togglingLabel = toggling ? (inWatchlist ? 'Removing…' : 'Adding…') : label

  return (
    <motion.button
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggle();
      }}
      disabled={toggling}
      className={`${className} inline-flex items-center justify-center transition-all duration-300 ${
        variant === 'icon-only'
          ? 'p-2 rounded-full'
          : `px-3 py-2 rounded-md border ${
              inWatchlist
                ? 'bg-red-600 text-white border-red-600 hover:bg-red-700'
                : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
            }`
      }`}
      aria-label={togglingLabel}
      title={togglingLabel}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
    >
      <motion.div
        animate={toggling ? {
          rotate: [0, 10, -10, 0],
          transition: {
            duration: 0.6,
            repeat: Infinity,
            ease: "easeInOut"
          }
        } : { rotate: 0 }}
      >
        <Icon
          className={`w-5 h-5 ${
            variant === 'icon-only'
              ? (inWatchlist ? 'text-red-500' : '')
              : 'mr-2'
          }`}
        />
      </motion.div>
      {variant !== 'icon-only' && (
        <div className="relative overflow-hidden">
          <AnimatePresence mode="wait">
            <motion.span
              key={toggling ? 'toggling' : inWatchlist ? 'in-watchlist' : 'add-to-watchlist'}
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{
                opacity: 1,
                y: 0,
                scale: 1,
                transition: {
                  duration: 0.3,
                  ease: [0.4, 0, 0.2, 1]
                }
              }}
              exit={{
                opacity: 0,
                y: -10,
                scale: 0.95,
                transition: {
                  duration: 0.2,
                  ease: [0.4, 0, 0.2, 1]
                }
              }}
              className="text-sm block"
            >
              {togglingLabel}
            </motion.span>
          </AnimatePresence>
        </div>
      )}
    </motion.button>
  )
}
