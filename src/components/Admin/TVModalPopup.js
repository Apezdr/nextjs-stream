'use client'
import { Fragment, useEffect, useRef, useState } from 'react'
import { Dialog, Transition } from '@headlessui/react'
import { PencilSquareIcon } from '@heroicons/react/24/outline'
import { saveTVSeriesModalChanges } from '../../utils/admin_frontend_database'

export default function TVModalPopup({
  record,
  updateRecord, // This can be used for updating the record
  isAdding,
  isOpen,
  setIsOpen,
  updateProcessedData,
}) {
  // State for managing title
  const [title, setTitle] = useState('')
  // State for managing seasons and episodes
  const [seasons, setSeasons] = useState(record.seasons || [])
  const cancelButtonRef = useRef(null)

  useEffect(() => {
    if (record && record.seasons) {
      // Initialize with existing data for editing
      setTitle(record.title || '')
      setSeasons(record.seasons)
    } else {
      // Initialize with empty data for adding
      setTitle('')
      setSeasons([])
    }
  }, [record])

  useEffect(() => {
    if (record && record.seasons) {
      setSeasons(record.seasons)
    }
  }, [record])

  const addSeason = () => {
    setSeasons([...seasons, { seasonNumber: seasons.length + 1, episodes: [] }])
  }

  const addEpisode = (seasonIndex) => {
    const newSeasons = [...seasons]
    // Check if the episodes array exists for the season, if not, initialize it
    if (!newSeasons[seasonIndex].episodes) {
      newSeasons[seasonIndex].episodes = []
    }
    const newEpisodeNumber = newSeasons[seasonIndex].episodes.length + 1
    newSeasons[seasonIndex].episodes.push({
      episodeNumber: newEpisodeNumber,
      title: '',
      videoURL: '',
    })
    setSeasons(newSeasons)
  }

  const removeEpisode = (seasonIndex, episodeIndex) => {
    const newSeasons = [...seasons]
    newSeasons[seasonIndex].episodes.splice(episodeIndex, 1)
    setSeasons(newSeasons)
  }

  const updateEpisode = (seasonIndex, episodeIndex, field, value) => {
    const newSeasons = [...seasons]
    newSeasons[seasonIndex].episodes[episodeIndex][field] = value
    setSeasons(newSeasons)
  }

  const updateSeasonNumber = (seasonIndex, value) => {
    const newSeasons = [...seasons]
    newSeasons[seasonIndex].seasonNumber = Number(value)
    setSeasons(newSeasons)
  }

  const removeSeason = (seasonIndex) => {
    const newSeasons = seasons.filter((_, index) => index !== seasonIndex)
    setSeasons(newSeasons)
  }

  // Render UI for seasons and episodes
  const renderSeasons = () => {
    return seasons.map((season, seasonIndex) => (
      <div key={`season-${seasonIndex}`} className="mt-4">
        <div className="flex items-center justify-center">
          <input
            type="number"
            value={season.seasonNumber}
            onChange={(e) => updateSeasonNumber(seasonIndex, e.target.value)}
            className="mr-2 w-16"
          />
          <h3 className="text-lg font-bold inline">Season {season.seasonNumber}</h3>
          <button
            type="button"
            className="bg-indigo-600 hover:bg-indigo-500 focus-visible:outline-indigo-600 rounded px-2 py-1 text-base font-semibold text-white shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ml-2"
            onClick={() => removeSeason(seasonIndex)}
          >
            Remove Season
          </button>
        </div>
        {season?.episodes?.map((episode, episodeIndex) => (
          <div key={`episode-${episodeIndex}`} className="mt-2">
            <input
              type="number"
              name={`episodeNumber-${season.seasonNumber - 1}-${episodeIndex}`}
              placeholder="Episode Number"
              value={episode.episodeNumber || episodeIndex + 1} // Default to episodeIndex + 1 if not set
              onChange={(e) =>
                updateEpisode(seasonIndex, episodeIndex, 'episodeNumber', parseInt(e.target.value))
              }
              className="mr-2 max-w-[80px]"
            />
            <input
              type="text"
              name={`episodeTitle-${season.seasonNumber - 1}-${episodeIndex}`} // Updated
              placeholder="Episode Title"
              value={episode.title}
              title={episode.title}
              onChange={(e) => updateEpisode(seasonIndex, episodeIndex, 'title', e.target.value)}
              className="mr-2"
            />
            <input
              type="text"
              name={`episodeURL-${season.seasonNumber - 1}-${episodeIndex}`} // Updated
              placeholder="Episode Video URL"
              value={episode.videoURL}
              title={episode.videoURL}
              onChange={(e) => updateEpisode(seasonIndex, episodeIndex, 'videoURL', e.target.value)}
            />
            <input
              type="hidden"
              name={`episodeRecord-${season.seasonNumber - 1}-${episodeIndex}`} // Updated
              value={JSON.stringify(episode)}
            />
            <button
              type="button"
              className="bg-indigo-600 hover:bg-indigo-500 focus-visible:outline-indigo-600 rounded px-2 py-1 text-base font-semibold text-white shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ml-2"
              onClick={() => removeEpisode(seasonIndex, episodeIndex)}
            >
              Remove Episode
            </button>
          </div>
        ))}
        <button
          type="button"
          className="bg-indigo-600 hover:bg-indigo-500 focus-visible:outline-indigo-600 rounded px-2 py-1 text-base font-semibold text-white shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 mt-2"
          onClick={() => addEpisode(seasonIndex)}
        >
          Add Episode
        </button>
      </div>
    ))
  }

  let poster = record.posterURL || record.metadata?.high_quality_poster
  if (!poster) {
    poster = null
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
          <div className="fixed inset-0 bg-gray-500/75 transition-opacity" />
        </Transition.Child>
        <div className="fixed inset-0 z-10 overflow-y-auto">
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
              <Dialog.Panel className="relative transform overflow-hidden rounded-lg bg-white px-4 pb-4 pt-5 text-left shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-4xl sm:p-6">
                <form action={saveTVSeriesModalChanges}>
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-blue-100">
                    {poster ? (
                      <img src={poster} alt={record.title} className="h-full w-full rounded-full" />
                    ) : (
                      <PencilSquareIcon className="h-6 w-6 text-blue-600" aria-hidden="true" />
                    )}
                  </div>
                  <div className="mt-3 text-center sm:mt-5">
                    <Dialog.Title as="h3" className="text-lg leading-6 font-medium text-gray-900">
                      {isAdding ? 'Adding New TV Series' : `Editing ${record.title}`}
                    </Dialog.Title>
                    <div className="mt-2">
                      <label htmlFor="title" className="block text-sm font-medium text-gray-700">
                        Title
                      </label>
                      <input
                        type="text"
                        name="title"
                        id="title"
                        className="mt-1 block w-full border-gray-300 shadow-sm sm:text-sm rounded-md"
                        placeholder="Enter TV Series Title"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                      />
                      {renderSeasons()}
                      <input type="hidden" name="record" value={JSON.stringify(record)} />
                      <input type="hidden" name="type" value={record.type} />
                      <button
                        type="button"
                        className="bg-indigo-600 hover:bg-indigo-500 focus-visible:outline-indigo-600 rounded px-2 py-1 text-base font-semibold text-white shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 mt-2"
                        onClick={addSeason}
                      >
                        Add Season
                      </button>
                    </div>
                  </div>
                  <div className="mt-5 sm:mt-6 sm:grid sm:grid-flow-row-dense sm:grid-cols-2 sm:gap-3">
                    <button
                      type="submit"
                      className="inline-flex w-full justify-center rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 sm:col-start-2"
                      onClick={async () => {
                        updateProcessedData('media')
                        setIsOpen(false)
                      }}
                    >
                      Save Changes
                    </button>
                    <button
                      type="button"
                      className="mt-3 inline-flex w-full justify-center rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 sm:col-start-1 sm:mt-0"
                      onClick={() => setIsOpen(false)}
                      ref={cancelButtonRef}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition.Root>
  )
}
