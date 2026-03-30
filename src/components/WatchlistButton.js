'use client'

import { useCallback } from 'react'
import useSWR from 'swr'
import useSWRMutation from 'swr/mutation'
import { HeartIcon } from '@heroicons/react/24/outline'
import { HeartIcon as HeartIconSolid } from '@heroicons/react/24/solid'
import { toast } from 'react-toastify'
import { authClient } from '@src/lib/auth-client'
import { LoadingDots } from '@src/app/loading'
import { AnimatePresence, motion } from 'framer-motion'

// Hoist static animation variants outside component to avoid recreating on each render
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

// SWR fetcher with ETag support
const statusFetcher = async (url) => {
  const res = await fetch(url, {
    method: 'GET',
    credentials: 'include',
    headers: { Accept: 'application/json' }
  })
  if (!res.ok) throw new Error(`Status ${res.status}`)
  return res.json()
}

// Toggle mutation fetcher
const toggleFetcher = async (url, { arg: body }) => {
  const res = await fetch(url, {
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
  return res.json()
}

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
  const { data: session, isPending } = authClient.useSession()

  // Build the SWR key - all instances with same mediaId/tmdbId share this cache entry
  const statusKey = session 
    ? `/api/authenticated/watchlist?action=status&mediaId=${mediaId}&tmdbId=${tmdbId}`
    : null

  // Fetch watchlist status - shared across all instances
  const { data: statusData, isLoading: isChecking, mutate } = useSWR(
    statusKey,
    statusFetcher,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
      dedupingInterval: 60000 // 1 minute
    }
  )

  const inWatchlist = !!statusData?.inWatchlist

  // Build query params for toggle
  const buildParams = useCallback((action) => {
    const params = new URLSearchParams()
    params.set('action', action)
    if (mediaId) params.set('mediaId', mediaId)
    if (tmdbId) params.set('tmdbId', tmdbId.toString())
    return params.toString()
  }, [mediaId, tmdbId])

  // Toggle mutation - after success, mutate() updates ALL instances
  const { trigger: toggle, isMutating } = useSWRMutation(
    `/api/authenticated/watchlist?${buildParams('toggle')}`,
    toggleFetcher,
    {
      onSuccess: async (result) => {
        const added = result.action === 'added'
        
        // Update this instance's state
        onStatusChange?.(added, result.item)

        // Revalidate the status key to update ALL instances with same mediaId/tmdbId
        await mutate(statusData => ({
          ...statusData,
          inWatchlist: added,
          item: added ? result.item : null
        }), false)

        toast[added ? 'success' : 'info'](
          <div className="flex flex-col">
            <span className="font-medium">
              {added ? 'Added to Watchlist' : 'Removed from Watchlist'}
            </span>
            <span className="text-xs opacity-75">{title}</span>
          </div>
        )
      },
      onError: (error) => {
        console.error('toggleWatchlist error', error)
        toast.error(error.message || 'Something went wrong')
      }
    }
  )

  const handleToggle = async (e) => {
    e.preventDefault()
    e.stopPropagation()

    if (isPending || isChecking || isMutating || !session) {
      if (!session) toast.error('Please sign in')
      return
    }

    const body = { mediaType, title }
    if (mediaId) {
      body.mediaId = mediaId
    } else if (tmdbId) {
      body.tmdbId = tmdbId
    }
    if (posterURL) {
      body.posterURL = posterURL
    }

    await toggle(body)
  }

  // While loading session or status
  if (isPending || isChecking) {
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
  if (!isPending && !session) return null

  // Pick icon/text
  const Icon = inWatchlist ? HeartIconSolid : HeartIcon
  const label = inWatchlist ? 'In Watchlist' : 'Add to Watchlist'
  const togglingLabel = isMutating ? (inWatchlist ? 'Removing…' : 'Adding…') : label

  return (
    <motion.button
      onClick={handleToggle}
      disabled={isMutating}
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
        animate={isMutating ? {
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
      {variant !== 'icon-only' ? (
        <div className="relative overflow-hidden">
          <AnimatePresence mode="wait">
            <motion.span
              key={isMutating ? 'toggling' : inWatchlist ? 'in-watchlist' : 'add-to-watchlist'}
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
      ) : null}
    </motion.button>
  )
}
