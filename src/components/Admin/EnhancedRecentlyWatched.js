'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { memo, useState, useCallback, useEffect } from 'react'
import Loading from '@src/app/loading'
import { classNames, buildURL } from '@src/utils'
import Image from 'next/image'
import Link from 'next/link'
import { StatusBadge } from './BaseComponents'
import DeviceBadge from './DeviceBadge'
import { PencilSquareIcon } from '@heroicons/react/24/outline'
import {
  buildWatchHistoryAdminEditHref,
  buildWatchHistoryLibraryHref,
  buildWatchHistoryPlaybackHref,
  formatPlaybackPosition,
} from '@src/utils/watchHistoryPlayback'
import {
  PLAYBACK_END_STATE_LABELS,
  normalizePlaybackEndState,
} from '@src/utils/watchHistory/playbackState'

// Darker than the surrounding gray-400 labels: these sit at text-xs on white,
// where the -600 shades fall under the WCAG AA 4.5:1 minimum.
const END_STATE_TONES = {
  error: 'text-red-700',
  buffering: 'text-amber-700',
  ended: 'text-emerald-700',
  paused: 'text-gray-700',
  playing: 'text-gray-700',
}
import { useAppDateFormatter } from '@src/contexts/AppTimeZoneContext'

const fade = { hidden: { opacity: 0 }, enter: { opacity: 1 } }

export default memo(function EnhancedRecentlyWatched({ recentlyWatched }) {
  const [selectedUser, setSelectedUser] = useState(null)
  const [isUserModalOpen, setIsUserModalOpen] = useState(false)
  const [expandedUserData, setExpandedUserData] = useState(null)
  const [isLoading, setIsLoading] = useState(false)
  const [currentPage, setCurrentPage] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [sortType, setSortType] = useState('lastWatched') // 'alphabetical' or 'lastWatched'
  const [sortOrder, setSortOrder] = useState('desc') // 'asc' or 'desc'
  const normalizedRecentlyWatched = Array.isArray(recentlyWatched)
    ? recentlyWatched
    : Array.isArray(recentlyWatched?.data)
      ? recentlyWatched.data
      : []

  useEffect(() => {
    if (selectedUser) setCurrentPage(0)
  }, [selectedUser])

  const fetchUserData = useCallback(async (userId, page = 0) => {
    setIsLoading(true)
    try {
      const res = await fetch(
        buildURL(`/api/authenticated/admin/user-recently-watched/${userId}?page=${page}&limit=10`)
      )
      if (!res.ok) throw new Error('Failed to fetch user data')
      const data = await res.json()
      setExpandedUserData(data)
      setTotalPages(data.pagination?.totalPages || 1)
    } catch (e) {
      console.error(e)
    } finally {
      setIsLoading(false)
    }
  }, [])

  const handleUserClick = useCallback((userData) => {
    setSelectedUser(userData)
    const userId = userData?.user?._id
    if (!userId) return console.error('No user ID found:', userData?.user)
    fetchUserData(userId)
    setIsUserModalOpen(true)
  }, [fetchUserData])

  const handlePageChange = useCallback((newPage) => {
    if (newPage >= 0 && newPage < totalPages && selectedUser) {
      setCurrentPage(newPage)
      fetchUserData(selectedUser.user._id, newPage)
    }
  }, [selectedUser, totalPages, fetchUserData])

  // Sorting logic
  const sortedRecentlyWatched = normalizedRecentlyWatched.length > 0 ? [...normalizedRecentlyWatched].sort((a, b) => {
    if (sortType === 'alphabetical') {
      const nameA = a.user?.name?.toLowerCase() || ''
      const nameB = b.user?.name?.toLowerCase() || ''
      return sortOrder === 'asc' ? nameA.localeCompare(nameB) : nameB.localeCompare(nameA)
    } else { // lastWatched
      // Get the most recent video for each user
      const getLatestTimestamp = (videos) => {
        if (!videos || videos.length === 0) return 0
        return Math.max(...videos.map(v => {
          const ts = v.lastWatchedTimestamp || v.lastWatchedDate
          return ts ? new Date(ts).getTime() || 0 : 0
        }))
      }
      
      const timestampA = getLatestTimestamp(a.videos)
      const timestampB = getLatestTimestamp(b.videos)
      
      return sortOrder === 'asc' ? timestampA - timestampB : timestampB - timestampA
    }
  }) : []

  return (
    <div className="h-full">
      {/* Live Indicator and Sort Controls */}
      <div className="flex flex-col sm:flex-row items-center justify-between mb-4">
        <div className="flex items-center space-x-2">
          <h3 className="text-lg font-semibold text-gray-900">Live Activity</h3>
          <StatusBadge status="success" size="small" pulse>
            LIVE
          </StatusBadge>
        </div>
        <div className="flex items-center space-x-4">
          {/* Sort Controls */}
          <div className="flex items-center space-x-2">
            <label className="text-sm font-medium text-gray-700">Sort:</label>
            <select
              value={sortType}
              onChange={(e) => setSortType(e.target.value)}
              className="text-sm text-gray-700 border-gray-300 rounded-md shadow-sm focus:border-blue-500 focus:ring-blue-500"
            >
              <option value="lastWatched">Last Watched</option>
              <option value="alphabetical">Alphabetical</option>
            </select>
            <button
              onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
              className="p-1 text-gray-500 hover:text-gray-700 transition-colors"
              title={`Sort ${sortOrder === 'asc' ? 'Descending' : 'Ascending'}`}
            >
              {sortOrder === 'asc' ? (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4h13M3 8h9m-9 4h9m5-4v12m0 0l-4-4m4 4l4-4" />
                </svg>
              )}
            </button>
          </div>
          <span className="text-sm text-gray-500">Auto-refreshing</span>
        </div>
      </div>

      {/* Content */}
      <div className={classNames(
        'transition-all duration-500',
        recentlyWatched ? 'max-h-96 overflow-auto' : 'h-48'
      )}>
        <AnimatePresence mode="wait">
          {recentlyWatched ? (
            <motion.div
              variants={fade}
              initial="hidden"
              animate="enter"
              exit="hidden"
              transition={{ duration: 0.25 }}
              className="space-y-4"
            >
              <RecentlyWatchedInner
                recentlyWatched={sortedRecentlyWatched}
                onUserClick={handleUserClick}
              />
            </motion.div>
          ) : (
            <motion.div 
              variants={fade} 
              initial="hidden" 
              animate="enter" 
              exit="hidden"
              className="flex items-center justify-center h-48"
            >
              <Loading fullscreenClasses={false} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Modal */}
      {isUserModalOpen && selectedUser && (
        <UserDetailModal
          isOpen={isUserModalOpen}
          onClose={() => setIsUserModalOpen(false)}
          userData={expandedUserData}
          isLoading={isLoading}
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={handlePageChange}
        />
      )}
    </div>
  )
})

/* ---------- Row (lane) ---------- */

const RecentlyWatchedInner = memo(function RecentlyWatchedInner({ recentlyWatched, onUserClick }) {
  return recentlyWatched.map((media) => {
    // Create a more stable key using user ID and latest video timestamp
    const latestTimestamp = media.videos.length > 0
      ? Math.max(...media.videos.map(v => new Date(v.lastWatchedDate).getTime() || 0))
      : Date.now()
    
    return (
      <UserLane
        key={`${media.user._id}-${latestTimestamp}`}
        media={media}
        onUserClick={onUserClick}
      />
    )
  })
})

const UserLane = memo(function UserLane({ media, onUserClick }) {
  const videos = media.videos.slice(0, 3) // Show up to 3 compact chips to fit better
  const totalCount = media.totalCount || media.videos.length // Use total count from API or fallback
  const remainingCount = totalCount - videos.length

  return (
    <div className="bg-gray-50 rounded-lg p-4 border border-gray-200 hover:bg-gray-100 transition-colors duration-200">
      <div className="flex items-center justify-between mb-3">
        {/* User Info */}
        <div className="flex items-center space-x-3">
          <Image
            src={media.user.image}
            alt={media.user.name}
            width={32}
            height={32}
            className="h-8 w-8 rounded-full ring-2 ring-blue-100 object-cover"
          />
          <div>
            <div className="font-medium text-gray-900 text-sm">{media.user.name}</div>
            <div className="text-xs text-gray-500">
              {totalCount === 1 ? '1 item watched' : `${totalCount} items watched`}
            </div>
          </div>
        </div>
        
        {/* See More Button */}
        <button
          onClick={() => onUserClick(media)}
          className="px-3 py-1 text-xs font-medium text-blue-600 bg-blue-50 rounded-md hover:bg-blue-100 transition-colors duration-200 flex items-center space-x-1"
        >
          <span>View All</span>
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {/* Media Grid */}
      <div className="grid grid-cols-4 gap-3">
        {videos.map((v) => (
          <MediaChip key={`${media.user._id}-${v.id}`} video={v} />
        ))}
        {remainingCount > 0 && (
          <div className="flex items-center justify-center bg-gray-200 rounded-lg p-2 text-xs font-medium text-gray-600">
            +{remainingCount} more
          </div>
        )}
      </div>
    </div>
  )
})

/* ---------- Media Chip ---------- */

// Paused wins over buffering so a player paused mid-stall reads as paused,
// matching what the Media Activity API reports for the same session.
function getPlaybackStatus(video) {
  if (video?.isPaused) return { status: 'warning', label: 'Paused', pulse: false }
  if (video?.isBuffering) return { status: 'info', label: 'Buffering', pulse: true }
  return { status: 'success', label: 'Watching', pulse: true }
}

function MediaChip({ video }) {
  const { formatDateTime } = useAppDateFormatter()
  const title = video?.title || 'Unknown'
  const isTv = video?.type === 'tv'
  const playbackStatus = getPlaybackStatus(video)
  const pct = Math.min(
    100,
    Math.max(0, ((video?.playbackTime || 0) / ((video?.duration || 1) / 1000)) * 100)
  ).toFixed(0)
  const libraryHref = buildWatchHistoryLibraryHref(video)
  const editHref = buildWatchHistoryAdminEditHref(video)
  const activityTime = video.lastWatchedTimestamp
    ? formatDateTime(video.lastWatchedTimestamp, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: undefined })
    : video.lastWatchedDate || 'Unknown'

  return (
    <div className="group bg-white rounded-lg border border-gray-200 overflow-hidden hover:shadow-md transition-shadow duration-200">
      <div className="relative w-full aspect-[3/4]">
        {libraryHref ? (
          <Link href={libraryHref} aria-label={`View ${title} in the library`} className="block h-full">
            <Image
              src={video.posterURL || '/sorry-image-not-available.jpg'}
              alt={title}
              fill
              unoptimized
              sizes="(max-width: 768px) 120px, 160px"
              className="object-cover transition-opacity hover:opacity-90"
            />
          </Link>
        ) : (
          <Image
            src={video.posterURL || '/sorry-image-not-available.jpg'}
            alt={title}
            fill
            unoptimized
            sizes="(max-width: 768px) 120px, 160px"
            className="object-cover"
          />
        )}

        {editHref ? (
          <Link
            href={editHref}
            title={`Edit ${title}`}
            aria-label={`Edit ${title}`}
            className="absolute left-1 top-1 z-20 flex h-8 w-8 items-center justify-center rounded-md bg-white/95 text-gray-700 opacity-0 shadow transition hover:bg-white hover:text-indigo-600 focus-visible:opacity-100 group-hover:opacity-100"
          >
            <PencilSquareIcon className="h-4 w-4" />
          </Link>
        ) : null}
        
        {/* Device Badge */}
        {video.deviceInfo?.deviceType && (
          <div className="absolute top-1 right-1">
            <DeviceBadge
              deviceType={video.deviceInfo.deviceType}
              userAgent={video.deviceInfo.userAgentTruncated}
              style="badge"
              size="small"
            />
          </div>
        )}

        {/* Watching Now Badge */}
        {video.watchingNow && (
          <div className={classNames('absolute top-1', editHref ? 'left-10' : 'left-1')}>
            <StatusBadge
              status={playbackStatus.status}
              size="small"
              pulse={playbackStatus.pulse}
            >
              {playbackStatus.label}
            </StatusBadge>
          </div>
        )}

        {/* Progress Bar */}
        <div className="absolute bottom-0 left-0 right-0 h-1 bg-black bg-opacity-20">
          <div className="h-1 bg-blue-500" style={{ width: `${pct}%` }} />
        </div>
      </div>
      
      <div className="p-2">
        <div className="text-xs font-medium text-gray-900 truncate">
          {isTv ? (video.showTitleFormatted || title) : title}
        </div>
        {isTv && video.title && (
          <div className="text-xs text-gray-500 truncate">{video.title}</div>
        )}
        
        <div className="mt-1 flex items-center justify-between gap-2">
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
            {formatPlaybackPosition(video.playbackTime)} · {pct}%
          </span>
          <span className="truncate text-xs text-gray-400" title={`Last activity: ${activityTime}`}>{activityTime}</span>
        </div>
      </div>
    </div>
  )
}

/* ---------- Modal ---------- */

function UserDetailModal({ isOpen, onClose, userData, isLoading, currentPage, totalPages, onPageChange }) {
  if (!isOpen) return null
  const userName = userData?.user?.name || 'User'
  const userImage = userData?.user?.image || '/sorry-image-not-available.jpg'
  const mediaItems = userData?.data || []

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 12 }}
        className="w-full max-w-6xl overflow-hidden rounded-xl bg-white shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4 bg-gray-50">
          <div className="flex items-center space-x-3">
            <Image src={userImage} alt={userName} width={40} height={40} className="h-10 w-10 rounded-full ring-2 ring-gray-200" />
            <h3 className="text-lg font-semibold text-gray-900">{userName}&rsquo;s Watch History</h3>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-gray-400 hover:bg-gray-200 hover:text-gray-600 transition"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="max-h-[70vh] overflow-auto p-6 min-h-[60vh]">
          {isLoading ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 9 }).map((_, i) => (
                <div key={i} className="h-44 animate-pulse rounded-lg bg-gray-200" />
              ))}
            </div>
          ) : mediaItems.length ? (
            <motion.div
              key={`user-${userData?.user?._id}-page-${currentPage}`}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18 }}
              className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3"
            >
              {mediaItems.map((item) => (
                <ModalMediaCard key={item.id} item={item} />
              ))}
            </motion.div>
          ) : (
            <div className="flex h-60 items-center justify-center text-gray-500">No media found for this user.</div>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 border-t border-gray-200 px-6 py-4 bg-gray-50">
            <button
              onClick={() => onPageChange(currentPage - 1)}
              disabled={currentPage === 0}
              className={classNames(
                'rounded-md px-3 py-1 text-sm transition',
                currentPage === 0
                  ? 'cursor-not-allowed bg-gray-100 text-gray-400'
                  : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-300'
              )}
            >
              Previous
            </button>
            <span className="rounded-md bg-blue-50 px-3 py-1 text-sm text-blue-700 border border-blue-200">
              Page {currentPage + 1} of {totalPages}
            </span>
            <button
              onClick={() => onPageChange(currentPage + 1)}
              disabled={currentPage === totalPages - 1}
              className={classNames(
                'rounded-md px-3 py-1 text-sm transition',
                currentPage === totalPages - 1
                  ? 'cursor-not-allowed bg-gray-100 text-gray-400'
                  : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-300'
              )}
            >
              Next
            </button>
          </div>
        )}
      </motion.div>
    </div>
  )
}

/* ---------- Modal Card ---------- */

function ModalMediaCard({ item }) {
  const { formatDateTime } = useAppDateFormatter()
  const isTv = item.type === 'tv'
  const pct = Math.min(
    100,
    Math.max(0, ((item?.playbackTime || 0) / ((item?.duration || 1) / 1000)) * 100)
  ).toFixed(0)
  const playbackHref = buildWatchHistoryPlaybackHref(item)
  const libraryHref = buildWatchHistoryLibraryHref(item)
  const endState = normalizePlaybackEndState(item.sessionEndState)
  const editHref = buildWatchHistoryAdminEditHref(item)
  const startedAt = item.sessionStartedAt
    ? formatDateTime(item.sessionStartedAt)
    : 'Not recorded for this legacy session'
  const stoppedAt = item.sessionStoppedAt
    ? formatDateTime(item.sessionStoppedAt)
    : item.lastWatchedTimestamp ? formatDateTime(item.lastWatchedTimestamp) : 'Not recorded'
  const stoppedLabel = item.sessionStoppedAt ? 'Stopped' : 'Last activity'
  const durationSeconds = Number(item.duration) > 0 ? Number(item.duration) / 1000 : null

  return (
    <div className="group overflow-hidden rounded-lg bg-white border border-gray-200 transition hover:shadow-md">
      <div className="relative">
        {libraryHref ? (
          <Link href={libraryHref} aria-label={`View ${item.title} in the library`} className="block">
            <Image
              src={item.posterURL || '/sorry-image-not-available.jpg'}
              alt={item.title}
              width={isTv ? 352 : 138}
              height={isTv ? 144 : 208}
              unoptimized
              className={classNames(
                'mx-auto object-cover transition-opacity hover:opacity-90',
                isTv ? 'h-36 w-full' : 'h-52 w-auto'
              )}
            />
          </Link>
        ) : (
          <Image
            src={item.posterURL || '/sorry-image-not-available.jpg'}
            alt={item.title}
            width={isTv ? 352 : 138}
            height={isTv ? 144 : 208}
            unoptimized
            className={classNames('mx-auto object-cover', isTv ? 'h-36 w-full' : 'h-52 w-auto')}
          />
        )}

        {editHref ? (
          <Link
            href={editHref}
            title={`Edit ${item.title}`}
            aria-label={`Edit ${item.title}`}
            className="absolute left-2 top-2 z-20 flex h-9 w-9 items-center justify-center rounded-md bg-white/95 text-gray-700 opacity-0 shadow transition hover:bg-white hover:text-indigo-600 focus-visible:opacity-100 group-hover:opacity-100"
          >
            <PencilSquareIcon className="h-5 w-5" />
          </Link>
        ) : null}
        
        {/* Device Badge */}
        {item.deviceInfo?.deviceType && (
          <div className="absolute top-2 right-2">
            <DeviceBadge
              deviceType={item.deviceInfo.deviceType}
              userAgent={item.deviceInfo.userAgentTruncated}
              style="badge"
              size="medium"
            />
          </div>
        )}
        
        <div className="absolute bottom-0 left-0 right-0 h-1 bg-black bg-opacity-20">
          <div className="h-full bg-blue-500" style={{ width: `${pct}%` }} />
        </div>
      </div>
      <div className="p-3">
        <div className="flex items-center justify-between gap-3">
          <h4 className="truncate text-sm font-semibold text-gray-900">
            {isTv ? item.showTitleFormatted || item.title : item.title}
          </h4>
          <span className="shrink-0 rounded bg-blue-100 px-1.5 py-0.5 text-xs font-semibold text-blue-800">
            {pct}%
          </span>
        </div>
        {isTv && item.title ? (
          <div className="mt-0.5 truncate text-xs text-gray-600">{item.title}</div>
        ) : null}
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 border-t border-gray-100 pt-3 text-xs">
          <dt className="text-gray-400">Started</dt>
          <dd className="text-right text-gray-700">{startedAt}</dd>
          <dt className="text-gray-400">{stoppedLabel}</dt>
          <dd className="text-right text-gray-700">{stoppedAt}</dd>
          <dt className="text-gray-400">Position</dt>
          <dd className="text-right font-medium text-gray-700">
            {formatPlaybackPosition(item.playbackTime)}
            {durationSeconds !== null ? ` / ${formatPlaybackPosition(durationSeconds)}` : ''}
          </dd>
          {endState ? (
            <>
              <dt className="text-gray-400">Stopped while</dt>
              <dd className={`text-right font-medium ${END_STATE_TONES[endState]}`}>
                {PLAYBACK_END_STATE_LABELS[endState]}
              </dd>
            </>
          ) : null}
        </dl>
        <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
          <div className="flex items-center space-x-2">
            {item.deviceInfo?.deviceType && (
              <DeviceBadge
                deviceType={item.deviceInfo.deviceType}
                userAgent={item.deviceInfo.userAgentTruncated}
                size="small"
                showLabel
              />
            )}
          </div>
          {playbackHref ? (
            <Link href={playbackHref} className="text-blue-600 hover:underline">
              Open at timestamp
            </Link>
          ) : <span />}
        </div>
      </div>
    </div>
  )
}