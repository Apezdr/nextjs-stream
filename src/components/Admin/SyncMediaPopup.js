'use client'

import { Dialog, Transition } from '@headlessui/react'
import { Fragment, useRef, useState } from 'react'
import { buildURL, classNames } from '@src/utils'

export default function SyncMediaPopup({
  isOpen,
  setIsOpen,
  updateProcessedData,
  setLastSync,
}) {
  const cancelButtonRef = useRef(null)
  const [syncData, setSyncData] = useState(null) // [tvData, moviesData]
  const [syncNotReady, setSyncNotReady] = useState(null) // [tvData, moviesData]
  const [loading, setLoading] = useState(false)
  const [complete, setComplete] = useState(false)

  const handleSyncClick = async () => {
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

      // Assuming the API returns the missing media and mp4 data correctly
      setSyncData({ missingMedia: data.missingMedia }) // Update state with the missing media data
      setSyncNotReady({ missingMp4: data.missingMp4 }) // Update state with the missing mp4 data

      // Here you might want to call updateProcessedData or any other
      // function necessary to update your UI or perform further operations
      // based on the sync results
      updateProcessedData('media')

      setLastSync(new Date()) // Update the last sync time

      setComplete(true) // Indicate that the sync operation is complete
    } catch (error) {
      console.error('Sync failed:', error)
      // Handle errors appropriately
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
                    <Dialog.Title as="h3" className="text-lg leading-6 font-medium text-gray-900">
                      Sync Media Files
                    </Dialog.Title>
                    <div className="mt-2">
                      <p className="text-sm text-gray-500">
                        Are you sure you want to sync the media files? This action will update your
                        local media database with the latest files from the server.
                      </p>
                      <hr className="my-4" />
                      {syncData && syncData.missingMedia.tv.length > 0 && (
                        <div className="mb-4">
                          <h2 className="text-xs font-bold text-center underline">
                            Missing TV Shows
                          </h2>
                          <ul>
                            {syncData.missingMedia.tv.map((show, showIndex) => (
                              <li className="font-bold" key={showIndex}>
                                {show.showTitle}
                                <ul className="ml-4 font-normal">
                                  {show.seasons.map((season, seasonIndex) => (
                                    <li className="text-xs" key={seasonIndex}>
                                      {typeof season === 'string' ? (
                                        `${season}`
                                      ) : (
                                        <div>
                                          Season: {season.season}
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

                      {syncData && syncData.missingMedia.movies.length > 0 && (
                        <div className="mb-4">
                          <h2 className="text-xs font-bold text-center underline">
                            Missing Movies
                          </h2>
                          <ul>
                            {syncData.missingMedia.movies.map((movie, index) => (
                              <li key={index}>{movie}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {syncNotReady && syncNotReady.missingMp4.movies.length > 0 && (
                        <div className="p-4 rounded-lg border border-gray-500">
                          <h2 className="text-xs font-bold text-center underline text-red-800">
                            Missing MP4 Files Unable to Sync these
                          </h2>
                          <h3 className="text-xs font-bold text-center underline text-red-600">
                            Movies
                          </h3>
                          <ul className="text-red-600 text-xs list-disc ml-4">
                            {syncNotReady.missingMp4.movies.map((movie, index) => (
                              <li key={index}>{movie}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {syncNotReady && syncNotReady.missingMp4.tv.length > 0 && (
                        <div className="p-4 rounded-lg border border-gray-500 mt-4">
                          <h3 className="text-xs font-bold text-center underline text-red-600">
                            TV Shows
                          </h3>
                          <ul className="text-red-600 text-xs list-disc ml-4">
                            {syncNotReady.missingMp4.tv.map((tvShow, index) => (
                              <li key={index}>{tvShow}</li>
                            ))}
                          </ul>
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
                    {complete ? 'Sync Complete' : loading ? 'Syncing...' : 'Sync'}
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
