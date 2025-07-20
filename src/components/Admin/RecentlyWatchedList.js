import { AnimatePresence, motion } from 'framer-motion'
import { memo, useState, useCallback, useEffect } from 'react'
import Loading from '@src/app/loading'
import { classNames, buildURL } from '@src/utils'
import Image from 'next/image'
import Link from 'next/link'

const variants = {
  hidden: { opacity: 0 },
  enter: { opacity: 1 },
}

function RecentlyWatched({ recentlyWatched }) {
  const [selectedUser, setSelectedUser] = useState(null)
  const [isUserModalOpen, setIsUserModalOpen] = useState(false)
  const [expandedUserData, setExpandedUserData] = useState(null)
  const [isLoading, setIsLoading] = useState(false)
  const [currentPage, setCurrentPage] = useState(0)
  const [totalPages, setTotalPages] = useState(1)

  // Reset pagination when selecting a new user
  useEffect(() => {
    if (selectedUser) {
      setCurrentPage(0)
    }
  }, [selectedUser])

  // Function to fetch expanded user data
  const fetchUserData = useCallback(async (userId, page = 0) => {
    setIsLoading(true)
    try {
      const response = await fetch(
        buildURL(`/api/authenticated/admin/user-recently-watched/${userId}?page=${page}&limit=10`)
      )
      if (!response.ok) {
        throw new Error('Failed to fetch user data')
      }
      const data = await response.json()
      setExpandedUserData(data)
      setTotalPages(data.pagination?.totalPages || 1)
      setIsLoading(false)
    } catch (error) {
      console.error('Error fetching user data:', error)
      setIsLoading(false)
    }
  }, [])

  // Handle opening the user modal
  const handleUserClick = useCallback((userData) => {
    setSelectedUser(userData)
    const userId = userData.user._id
    if (!userId) {
      console.error("No user ID found:", userData.user)
      return
    }
    fetchUserData(userId)
    setIsUserModalOpen(true)
  }, [fetchUserData])

  // Handle pagination
  const handlePageChange = useCallback((newPage) => {
    if (newPage >= 0 && newPage < totalPages && selectedUser) {
      setCurrentPage(newPage)
      fetchUserData(selectedUser.user._id, newPage)
    }
  }, [selectedUser, totalPages, fetchUserData])

  return (
    <div>
      <div className="flex flex-row">
        <h1>Recently Watched</h1>
        <div className="bg-red-500 text-white flex flex-row justify-center rounded-md select-none p-1 ml-2">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
            className="w-3.5 h-3.5"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9.348 14.652a3.75 3.75 0 0 1 0-5.304m5.304 0a3.75 3.75 0 0 1 0 5.304m-7.425 2.121a6.75 6.75 0 0 1 0-9.546m9.546 0a6.75 6.75 0 0 1 0 9.546M5.106 18.894c-3.808-3.807-3.808-9.98 0-13.788m13.788 0c3.808 3.807 3.808 9.98 0 13.788M12 12h.008v.008H12V12Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z"
            />
          </svg>
          <span className="ml-1 text-xs">LIVE</span>
        </div>
      </div>
      <div
        className={classNames(
          'transition-all delay-[2s] duration-[2s]',
          recentlyWatched ? 'h-96 mb-12 overflow-auto' : 'h-52'
        )}
      >
        <AnimatePresence mode="wait">
          {recentlyWatched ? (
            <motion.div
              variants={variants}
              initial="hidden"
              exit="hidden"
              animate="enter"
              key={recentlyWatched.length}
              transition={{
                type: 'linear',
                delay: 2,
                duration: 2,
              }}
              className="flex flex-col gap-8 max-w-7xl"
            >
              <RecentlyWatchedInner 
                recentlyWatched={recentlyWatched} 
                onUserClick={handleUserClick}
              />
            </motion.div>
          ) : (
            <motion.div
              variants={variants}
              initial="hidden"
              exit="hidden"
              animate="enter"
              key={'loading'}
              transition={{
                type: 'linear',
                delay: 0,
                duration: 2,
              }}
            >
              <Loading fullscreenClasses={false} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* User Detail Modal */}
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
}

const UserMediaItem = memo(function UserMediaItem({ media, onUserClick }) {
  // Only show the first two videos in the summary view
  const displayVideos = media.videos.slice(0, 2);

  return (
    <div className="grid grid-cols-2 text-center border-b border-b-gray-200 last:border-b-0">
      <div className="flex flex-row gap-8">
        <div className="flex flex-col w-full self-center relative">
          <Image
            src={media.user.image}
            alt={media.user.name}
            width={50}
            height={50}
            className="w-8 h-8 rounded-full self-center"
          />
          <span className="text-xs">{media.user.name}</span>
          
          {/* Add a "See More" button */}
          <button 
            onClick={() => onUserClick(media)}
            className="mt-2 py-1 px-2 bg-blue-500 hover:bg-blue-600 text-white text-xs rounded-md self-center transition-colors duration-200"
          >
            See More
          </button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {displayVideos.map((video) => {
          const title = video?.title || "Unknown";
          const videoKey = `${media.user._id}-${video.id}`;
          
          return (
            <div key={videoKey} className="flex flex-col">
              {video.type === 'tv' ? (
                // TV Show Display
                <>
                  <Image
                    src={video.posterURL || "/sorry-image-not-available.jpg"}
                    alt={title}
                    width={144}
                    height={96}
                    className="rounded-md self-center object-cover w-36 h-24"
                  />
                  <span className="text-sm truncate">{video.title}</span>
                  {video.showTitleFormatted && (
                    <span className="text-xs text-gray-600">{video.showTitleFormatted}</span>
                  )}
                </>
              ) : (
                // Movie Display
                <>
                  <Image
                    src={video.posterURL || "/sorry-image-not-available.jpg"}
                    alt={title}
                    width={96}
                    height={144}
                    className="rounded-md self-center object-cover w-24 h-36"
                  />
                  <span className="text-sm truncate">{video.title}</span>
                </>
              )}
              <span className="text-xs">
                Watched {((video.playbackTime / (video.duration / 1000)) * 100).toFixed(2)}%
              </span>
              <span className="text-xs">{video.lastWatchedDate}</span>
            </div>
          );
        })}
      </div>
    </div>
  )
}, areEqual)

function areEqual(prevProps, nextProps) {
  return (
    prevProps.media.user._id === nextProps.media.user._id &&
    prevProps.media.videos.length === nextProps.media.videos.length
  )
}

const RecentlyWatchedInner = memo(function RecentlyWatchedInner({ recentlyWatched, onUserClick }) {
  return recentlyWatched.map((media) => (
    <UserMediaItem
      key={`${media.user._id}-${media.videos.length}`}
      media={media}
      onUserClick={onUserClick}
    />
  ))
})

// Modal component for expanded user details
function UserDetailModal({ isOpen, onClose, userData, isLoading, currentPage, totalPages, onPageChange }) {
  if (!isOpen) return null;
  
  // Format user data for display
  const userName = userData?.user?.name || 'User';
  const userImage = userData?.user?.image || '/sorry-image-not-available.jpg';
  const mediaItems = userData?.data || [];

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Modal Header */}
        <div className="flex justify-between items-center border-b border-gray-200 p-4">
          <div className="flex items-center">
            <img src={userImage} alt={userName} className="h-10 w-10 rounded-full mr-3" />
            <h2 className="text-xl font-bold">{userName}'s Watch History</h2>
          </div>
          <button 
            onClick={onClose} 
            className="text-gray-500 hover:text-gray-700"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        
        {/* Modal Content */}
        <div className="grow overflow-auto p-4">
          {isLoading ? (
            <div className="flex justify-center items-center h-64">
              <Loading fullscreenClasses={false} />
            </div>
          ) : mediaItems.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {mediaItems.map((item) => (
                <MediaCard key={item.id} item={item} />
              ))}
            </div>
          ) : (
            <div className="flex justify-center items-center h-64 text-gray-500">
              No media found for this user.
            </div>
          )}
        </div>
        
        {/* Pagination */}
        {totalPages > 1 && (
          <div className="border-t border-gray-200 p-4 flex justify-center items-center space-x-2">
            <button
              onClick={() => onPageChange(currentPage - 1)}
              disabled={currentPage === 0}
              className={`px-3 py-1 rounded ${
                currentPage === 0 
                  ? 'bg-gray-200 text-gray-500 cursor-not-allowed' 
                  : 'bg-blue-500 text-white hover:bg-blue-600'
              }`}
            >
              Previous
            </button>
            <span className="text-gray-600">
              Page {currentPage + 1} of {totalPages}
            </span>
            <button
              onClick={() => onPageChange(currentPage + 1)}
              disabled={currentPage === totalPages - 1}
              className={`px-3 py-1 rounded ${
                currentPage === totalPages - 1 
                  ? 'bg-gray-200 text-gray-500 cursor-not-allowed' 
                  : 'bg-blue-500 text-white hover:bg-blue-600'
              }`}
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// Card for displaying media in the modal
function MediaCard({ item }) {
  // Calculate progress percentage
  const calculateProgress = () => {
    const playbackTime = item.playbackTime || 0;
    const duration = item.duration || 1;
    return ((playbackTime / (duration / 1000)) * 100).toFixed(2);
  };

  // Determine if the item is a TV show or movie
  const isTvShow = item.type === 'tv';
  
  return (
    <div className="bg-gray-50 rounded-lg overflow-hidden shadow transition-transform hover:scale-[1.02] hover:shadow-lg">
      <div className="relative">
        {/* Image */}
        <img
          src={item.posterURL || "/sorry-image-not-available.jpg"}
          alt={item.title}
          className={classNames(
            "mx-auto object-cover",
            isTvShow ? "h-32 w-full object-cover" : "h-48 w-auto object-contain"
          )}
        />
        
        {/* Progress bar */}
        <div className="absolute bottom-0 left-0 right-0 h-1 bg-gray-200">
          <div 
            className="h-full bg-green-500" 
            style={{ width: `${calculateProgress()}%` }}
          ></div>
        </div>
      </div>
      
      <div className="p-3">
        {/* Title */}
        <h3 className="font-semibold text-sm truncate">
          {isTvShow 
            ? item.showTitleFormatted || `${item.title}` 
            : item.title
          }
        </h3>
        
        {/* Progress */}
        <p className="text-xs text-gray-600 mt-1">
          Watched {calculateProgress()}%
        </p>
        
        {/* Date */}
        <p className="text-xs text-gray-500 mt-1">
          {item.lastWatchedDate}
        </p>

        {/* Title */}
        {(item.showTitleFormatted && item.title && !item.link) ? (
          <p className="text-xs text-gray-600 mt-1">
            {item.showTitleFormatted ?? item.title}
          </p>
        ) : null}

        {/* Link, if available */}
        {item.link && (
          <Link href={`/list/${item.type}/${item.link}`} className="text-xs text-blue-500 mt-1 truncate">
            {item.showTitleFormatted ?? item.title }
          </Link>
        )}
      </div>
    </div>
  );
}

export default memo(RecentlyWatched)
