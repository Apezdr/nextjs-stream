'use client';

import { AnimatePresence, motion } from 'framer-motion'
import { memo, useState, useCallback, useEffect } from 'react'
import Loading from '@src/app/loading'
import { classNames, buildURL } from '@src/utils'
import Image from 'next/image'
import Link from 'next/link'

const fade = { hidden: { opacity: 0 }, enter: { opacity: 1 } }

export default memo(function RecentlyWatched({ recentlyWatched }) {
  const [selectedUser, setSelectedUser] = useState(null)
  const [isUserModalOpen, setIsUserModalOpen] = useState(false)
  const [expandedUserData, setExpandedUserData] = useState(null)
  const [isLoading, setIsLoading] = useState(false)
  const [currentPage, setCurrentPage] = useState(0)
  const [totalPages, setTotalPages] = useState(1)

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

  return (
    <div className="relative max-w-[95vw]">
      {/* Header */}
      <div className="sticky top-0 z-10 mb-4">
        <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 backdrop-blur-sm shadow-sm">
          <h2 className="text-lg font-semibold tracking-tight">Recently Watched</h2>
          <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/15 px-2 py-0.5 text-[10px] font-semibold text-rose-300 ring-1 ring-inset ring-rose-500/30">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-rose-400" />
            </span>
            LIVE
          </span>
        </div>
      </div>

      {/* Body */}
      <div
        className={classNames(
          'transition-all duration-700',
          recentlyWatched ? 'max-h-96 overflow-auto pr-1' : 'h-52'
        )}
      >
        <AnimatePresence mode="wait">
          {recentlyWatched ? (
            <motion.div
              variants={fade}
              initial="hidden"
              animate="enter"
              exit="hidden"
              transition={{ duration: 0.25 }}
              className="flex flex-col divide-y divide-white/5"
            >
              <RecentlyWatchedInner
                recentlyWatched={recentlyWatched}
                onUserClick={handleUserClick}
              />
            </motion.div>
          ) : (
            <motion.div variants={fade} initial="hidden" animate="enter" exit="hidden">
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
  return recentlyWatched.map((media) => (
    <UserLane
      key={`${media.user._id}-${media.videos.length}`}
      media={media}
      onUserClick={onUserClick}
    />
  ))
})

const UserLane = memo(function UserLane({ media, onUserClick }) {
  const videos = media.videos.slice(0, 4) // show up to 4 compact chips

  return (
    <div className="grid grid-cols-[220px,1fr] items-center gap-4 py-4">
      {/* Left: avatar + name + button */}
      <div className="flex items-center gap-3 pl-1">
        <Image
          src={media.user.image}
          alt={media.user.name}
          width={48}
          height={48}
          className="h-10 w-10 rounded-full ring-1 ring-white/20 object-cover"
        />
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{media.user.name}</div>
          <button
            onClick={() => onUserClick(media)}
            className="mt-1 inline-flex items-center gap-1 rounded-lg bg-white/5 px-2 py-1 text-[11px] font-medium text-white/90 ring-1 ring-inset ring-white/10 hover:bg-white/10 transition"
          >
            See more
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
              <path d="M10.293 15.707a1 1 0 0 1 0-1.414L13.586 11H4a1 1 0 1 1 0-2h9.586l-3.293-3.293a1 1 0 1 1 1.414-1.414l5 5a1 1 0 0 1 0 1.414l-5 5a1 1 0 0 1-1.414 0z" />
            </svg>
          </button>
        </div>
      </div>

      {/* Right: media chips */}
      <div className="flex flex-wrap gap-3">
        {videos.map((v) => (
          <MediaChip key={`${media.user._id}-${v.id}`} video={v} />
        ))}
        {media.videos.length > videos.length && (
          <span className="self-center rounded-full bg-white/5 px-2 py-1 text-[11px] text-white/70 ring-1 ring-inset ring-white/10">
            +{media.videos.length - videos.length} more
          </span>
        )}
      </div>
    </div>
  )
})

/* ---------- Media Chip ---------- */

function MediaChip({ video }) {
  const title = video?.title || 'Unknown'
  const isTv = video?.type === 'tv'
  const pct = Math.min(
    100,
    Math.max(0, ((video?.playbackTime || 0) / ((video?.duration || 1) / 1000)) * 100)
  ).toFixed(0)

  return (
    <div className="group relative grid w-[180px] grid-cols-[56px,1fr] gap-2 rounded-xl bg-white/5 p-2 ring-1 ring-inset ring-white/10 hover:bg-white/10 transition">
      <div className="relative overflow-hidden rounded-lg">
        <Image
          src={video.posterURL || '/sorry-image-not-available.jpg'}
          alt={title}
          width={112}
          height={168}
          className={classNames(
            'h-24 w-14 object-cover',
            isTv ? 'rounded-md' : 'rounded-md'
          )}
        />
        {/* progress bar */}
        <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/10">
          <div className="h-1 bg-emerald-400" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className="min-w-0">
        <div className="truncate text-xs font-medium leading-5">
          {isTv ? (video.showTitleFormatted || title) : title}
        </div>
        {isTv && video.title ? (
          <div className="truncate text-[11px] text-white/60">{video.title}</div>
        ) : null}

        <div className="mt-1 flex items-center justify-between">
          <span className="rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300 ring-1 ring-inset ring-emerald-500/30">
            {pct}%
          </span>
          <span className="truncate text-[10px] text-white/50">{video.lastWatchedDate}</span>
        </div>
      </div>

      {/* hover lift */}
      <motion.span
        layoutId={`lift-${video.id}`}
        className="pointer-events-none absolute inset-0 rounded-xl"
        initial={false}
        whileHover={{ boxShadow: '0px 8px 20px rgba(0,0,0,0.35)', y: -1 }}
        transition={{ type: 'spring', stiffness: 300, damping: 25 }}
      />
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 12 }}
        className="w-full max-w-6xl overflow-hidden rounded-2xl bg-neutral-950/90 backdrop-blur-xl ring-1 ring-white/10"
      >
        {/* header */}
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div className="flex items-center gap-3">
            <Image src={userImage} alt={userName} width={40} height={40} className="h-10 w-10 rounded-full ring-1 ring-white/20" />
            <h3 className="text-base font-semibold">{userName}&rsquo;s Watch History</h3>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-white/70 hover:bg-white/5 hover:text-white transition"
            aria-label="Close"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6.225 4.811a1 1 0 0 1 1.414 0L12 9.172l4.361-4.361a1 1 0 1 1 1.414 1.414L13.414 10.586l4.361 4.361a1 1 0 0 1-1.414 1.414L12 12l-4.361 4.361a1 1 0 0 1-1.414-1.414l4.361-4.361-4.361-4.361a1 1 0 0 1 0-1.414Z" />
            </svg>
          </button>
        </div>

        {/* content */}
        <div className="max-h-[72vh] overflow-auto p-5 min-h-[70vh]">
          {isLoading ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 9 }).map((_, i) => (
                <div key={i} className="h-44 animate-pulse rounded-xl bg-white/5" />
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
            <div className="flex h-60 items-center justify-center text-white/60">No media found for this user.</div>
          )}
        </div>

        {/* pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 border-t border-white/10 px-5 py-3">
            <button
              onClick={() => onPageChange(currentPage - 1)}
              disabled={currentPage === 0}
              className={classNames(
                'rounded-full px-3 py-1 text-sm ring-1 ring-inset transition',
                currentPage === 0
                  ? 'cursor-not-allowed bg-white/5 text-white/40 ring-white/10'
                  : 'bg-white/10 text-white hover:bg-white/15 ring-white/15'
              )}
            >
              Previous
            </button>
            <span className="rounded-full bg-white/5 px-3 py-1 text-xs text-white/80 ring-1 ring-inset ring-white/10">
              Page {currentPage + 1} of {totalPages}
            </span>
            <button
              onClick={() => onPageChange(currentPage + 1)}
              disabled={currentPage === totalPages - 1}
              className={classNames(
                'rounded-full px-3 py-1 text-sm ring-1 ring-inset transition',
                currentPage === totalPages - 1
                  ? 'cursor-not-allowed bg-white/5 text-white/40 ring-white/10'
                  : 'bg-white/10 text-white hover:bg-white/15 ring-white/15'
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
  const isTv = item.type === 'tv'
  const pct = Math.min(
    100,
    Math.max(0, ((item?.playbackTime || 0) / ((item?.duration || 1) / 1000)) * 100)
  ).toFixed(0)

  return (
    <div className="overflow-hidden rounded-xl bg-white/5 ring-1 ring-inset ring-white/10 transition hover:bg-white/10">
      <div className="relative">
        <Image
          src={item.posterURL || '/sorry-image-not-available.jpg'}
          alt={item.title}
          width={isTv ? 352 : 138}
          height={isTv ? 144 : 208}
          className={classNames('mx-auto object-cover', isTv ? 'h-36 w-full' : 'h-52 w-auto')}
        />
        <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/10">
          <div className="h-full bg-emerald-400" style={{ width: `${pct}%` }} />
        </div>
      </div>
      <div className="p-3">
        <div className="flex items-center justify-between gap-3">
          <h4 className="truncate text-sm font-semibold">
            {isTv ? item.showTitleFormatted || item.title : item.title}
          </h4>
          <span className="shrink-0 rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300 ring-1 ring-inset ring-emerald-500/30">
            {pct}%
          </span>
        </div>
        {isTv && item.title ? (
          <div className="mt-0.5 truncate text-xs text-white/70">{item.title}</div>
        ) : null}
        <div className="mt-2 flex items-center justify-between text-[11px] text-white/60">
          <span>{item.lastWatchedDate}</span>
          {item.link ? (
            <Link href={`/list/${item.type}/${item.link}`} className="text-sky-300 hover:underline">
              Open
            </Link>
          ) : <span />}
        </div>
      </div>
    </div>
  )
}
