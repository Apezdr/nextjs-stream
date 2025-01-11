'use client'

import { Dialog, Transition } from '@headlessui/react'
import { Fragment, useRef, useState } from 'react'
import { classNames } from '@src/utils'

export default function SyncMediaPopup({
  isOpen,
  setIsOpen,
  updateProcessedData,
  setLastSync,
}) {
  const cancelButtonRef = useRef(null)
  const [syncData, setSyncData] = useState(null)    // Will store the full { missingMedia: {...} }
  const [syncNotReady, setSyncNotReady] = useState(null) // Will store the full { missingMp4: {...} }
  const [syncDuration, setSyncDuration] = useState(null) // Will store the full { duration: ... }
  const [syncstartTime, setSyncstartTime] = useState(null) // Will store the full { startTime: ... }
  const [loading, setLoading] = useState(false)
  const [complete, setComplete] = useState(false)

  const handleSyncClick = async () => {
    setComplete(false)
    setLoading(true)
    try {
      // Call the API endpoint to perform the sync operation
      const response = await fetch('/api/authenticated/admin/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })

      if (!response.ok) {
        throw new Error('Network response was not ok')
      }

      const data = await response.json()

      // Store both missingMedia and missingMp4 in state
      setSyncData({ missingMedia: data.missingMedia })
      setSyncNotReady({ missingMp4: data.missingMp4 })
      setSyncDuration(data.duration)
      setSyncstartTime(data.startTime)

      // Optionally call any callbacks to update other parts of your UI
      updateProcessedData('media')
      setLastSync(new Date())

      setComplete(true)
    } catch (error) {
      console.error('Sync failed:', error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Transition.Root show={isOpen} as={Fragment}>
      <Dialog
        as="div"
        className="relative z-10 text-black"
        initialFocus={cancelButtonRef}
        onClose={setIsOpen}
      >
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" />
        </Transition.Child>

        <div className="fixed inset-0 z-10 w-screen overflow-y-auto">
          <div className="flex min-h-full items-end justify-center p-4 text-center sm:items-center sm:p-0">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
              enterTo="opacity-100 translate-y-0 sm:scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 translate-y-0 sm:scale-100"
              leaveTo="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
            >
              <Dialog.Panel className="transform overflow-hidden rounded-lg bg-white px-4 pt-5 pb-4 text-left shadow-xl transition-all sm:my-8 sm:max-w-lg sm:w-full sm:p-6">
                <div className="sm:flex sm:items-start">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 sm:mx-0 sm:h-10 sm:w-10">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth="1.5"
                      stroke="currentColor"
                      className="w-6 h-6"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5"
                      />
                    </svg>
                  </div>

                  <div className="mt-3 text-center sm:mt-0 sm:ml-4 sm:text-left">
                    <Dialog.Title
                      as="h3"
                      className="text-lg leading-6 font-medium text-gray-900"
                    >
                      Sync Media Files
                    </Dialog.Title>

                    <div className="mt-2">
                      <p className="text-sm text-gray-500">
                        Are you sure you want to sync the media files? This action
                        will update your local media database with the latest files
                        from the server.
                      </p>

                      <hr className="my-4" />

                      {/* -------------------------
                          Display Missing Media
                          ------------------------- */}
                      {syncData && (
                        <>
                          {Object.entries(syncData.missingMedia).map(
                            ([serverName, { tv, movies }]) => {
                              const hasTv = tv && tv.length > 0
                              const hasMovies = movies && movies.length > 0

                              // If no missing items for this server, skip rendering
                              if (!hasTv && !hasMovies) return null

                              return (
                                <div className="mb-4" key={serverName}>
                                  <h2 className="text-xs font-bold underline">
                                    Missing Media from <span className="text-blue-600">{serverName}</span>
                                  </h2>

                                  {/* TV Shows */}
                                  {hasTv && (
                                    <div className="mt-2">
                                      <h3 className="text-xs font-bold text-center">
                                        Missing TV Shows
                                      </h3>
                                      <ul className="mt-1">
                                        {tv.map((show, showIndex) => (
                                          <li className="font-bold" key={showIndex}>
                                            {show.showTitle}
                                            <ul className="ml-4 font-normal">
                                              {show.seasons.map((season, seasonIndex) => (
                                                <li className="text-xs" key={seasonIndex}>
                                                  {typeof season === 'string' ? (
                                                    season
                                                  ) : (
                                                    <div>
                                                      <span className="font-semibold">
                                                        Season: {season.season}
                                                      </span>
                                                      <ul className="ml-8">
                                                        {season.missingEpisodes.map((episode, episodeIndex) => (
                                                          <li key={episodeIndex}>
                                                            {typeof episode === 'string'
                                                              ? episode
                                                              : episode.episodeFileName}
                                                          </li>
                                                        ))}
                                                      </ul>
                                                    </div>
                                                  )}
                                                </li>
                                              ))}
                                            </ul>
                                          </li>
                                        ))}
                                      </ul>
                                    </div>
                                  )}

                                  {/* Movies */}
                                  {hasMovies && (
                                    <div className="mt-3">
                                      <h3 className="text-xs font-bold text-center">
                                        Missing Movies
                                      </h3>
                                      <ul className="list-disc ml-4">
                                        {movies.map((movie, index) => (
                                          <li key={index}>{movie}</li>
                                        ))}
                                      </ul>
                                    </div>
                                  )}
                                </div>
                              )
                            }
                          )}
                        </>
                      )}

                      {/* -------------------------
                          Display Missing MP4
                          ------------------------- */}
                      {syncNotReady && (
                        <>
                          {Object.entries(syncNotReady.missingMp4).map(
                            ([serverName, { tv, movies }]) => {
                              const hasTv = tv && tv.length > 0
                              const hasMovies = movies && movies.length > 0

                              // If no MP4 issues for this server, skip
                              if (!hasTv && !hasMovies) return null

                              return (
                                <div
                                  key={serverName}
                                  className="p-4 mb-4 rounded-lg border border-gray-500"
                                >
                                  <h2 className="text-xs font-bold underline text-red-800 text-center">
                                    Missing MP4 Files on <span className="text-black">{serverName}</span>
                                  </h2>

                                  {/* Movies */}
                                  {hasMovies && (
                                    <div className="mt-2">
                                      <h3 className="text-xs font-bold underline text-red-600 text-center">
                                        Movies
                                      </h3>
                                      <ul className="text-red-600 text-xs list-disc ml-4 mt-1">
                                        {movies.map((movie, index) => (
                                          <li key={index}>{movie}</li>
                                        ))}
                                      </ul>
                                    </div>
                                  )}

                                  {/* TV Shows */}
                                  {hasTv && (
                                    <div className="mt-4">
                                      <h3 className="text-xs font-bold underline text-red-600 text-center">
                                        TV Shows
                                      </h3>
                                      <ul className="text-red-600 text-xs list-disc ml-4 mt-1">
                                        {tv.map((tvShow, index) => (
                                          <li key={index}>{tvShow}</li>
                                        ))}
                                      </ul>
                                    </div>
                                  )}
                                </div>
                              )
                            }
                          )}
                        </>
                      )}
                      {/* -------------------------
                          Display Sync Duration
                          ------------------------- */}
                      {syncstartTime && syncDuration && (
                        <div className="mt-4 bg-gradient-to-r from-gray-50 to-gray-100 p-4 rounded-lg shadow-sm border border-gray-200">
                          <div className="space-y-3">
                            <div className="flex items-center justify-between p-3 bg-white rounded-md shadow-sm hover:shadow-md transition-shadow duration-200">
                              <div className="flex items-center">
                                <span className="text-xl mr-2">🕒</span>
                                <span className="text-xs font-medium text-gray-600">Started</span>
                              </div>
                              <span className="text-xs font-semibold text-blue-600">
                                {new Date(syncstartTime).toLocaleString('en-US', {
                                  month: 'short',
                                  day: 'numeric',
                                  year: 'numeric',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                  second: '2-digit',
                                  hour12: true
                                })}
                              </span>
                            </div>

                            <div className="flex items-center justify-between p-3 bg-white rounded-md shadow-sm hover:shadow-md transition-shadow duration-200">
                              <div className="flex items-center">
                                <span className="text-xl mr-2">🏁</span>
                                <span className="text-xs font-medium text-gray-600">Ended</span>
                              </div>
                              <span className="text-xs font-semibold text-blue-600">
                                {new Date(new Date(syncstartTime).getTime() + (syncDuration * 1000)).toLocaleString('en-US', {
                                  month: 'short',
                                  day: 'numeric',
                                  year: 'numeric',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                  second: '2-digit',
                                  hour12: true
                                })}
                              </span>
                            </div>

                            <div className="flex items-center justify-between p-3 bg-white rounded-md shadow-sm hover:shadow-md transition-shadow duration-200">
                              <div className="flex items-center">
                                <span className="text-xl mr-2">⏱️</span>
                                <span className="text-xs font-medium text-gray-600">Duration</span>
                              </div>
                              <span className="text-xs font-semibold text-blue-600">
                                {syncDuration < 60 
                                  ? `${syncDuration.toFixed(2)} seconds`
                                  : `${(syncDuration / 60).toFixed(2)} minutes`}
                              </span>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="mt-5 sm:mt-4 sm:flex sm:flex-row-reverse">
                  <button
                    type="button"
                    className={classNames(
                      loading
                        ? 'bg-gray-400 hover:bg-gray-700 focus:ring-gray-500 cursor-not-allowed'
                        : 'bg-blue-600 hover:bg-blue-700 focus:ring-blue-500',
                      'w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2  text-base font-medium text-white focus:outline-none focus:ring-2 focus:ring-offset-2 sm:ml-3 sm:w-auto sm:text-sm'
                    )}
                    onClick={handleSyncClick}
                    disabled={loading}
                  >
                    {complete && !loading ? 'Sync Complete' : loading ? 'Syncing...' : 'Sync'}
                  </button>
                  <button
                    type="button"
                    className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 sm:mt-0 sm:w-auto sm:text-sm"
                    onClick={() => setIsOpen(false)}
                    ref={cancelButtonRef}
                  >
                    Cancel
                  </button>
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition.Root>
  )
}
