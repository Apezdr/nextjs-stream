'use client'
import { Fragment, memo, useEffect, useRef, useState } from 'react'
import { Dialog, Transition } from '@headlessui/react'
import { PencilSquareIcon, LockClosedIcon, LockOpenIcon } from '@heroicons/react/24/outline'
import { saveMovieModalChanges } from '../../utils/admin_frontend_database'
import { classNames, getFullImageUrl } from '../../utils'

function MovieModalPopup({
  record,
  updateRecord,
  isAdding,
  isOpen,
  setIsOpen,
  updateProcessedData,
}) {
  // Local state for managing form fields
  const [formState, setFormState] = useState({
    tmdb_id: '',
    title: '',
    videoURL: '',
    posterURL: '',
    posterBlurhash: '',
    chapterURL: '',
    logo: '',
    length: '',
    dimensions: '',
    backdrop: '',
    backdropBlurhash: '',
    // Add other fields as necessary
  })

  const [lockedFields, setLockedFields] = useState({})
  const [userLockedFields, setUserLockedFields] = useState({}) // New state to track user-locked fields
  const [captionStore, setCaptionStore] = useState([])
  const [newCaption, setNewCaption] = useState({
    label: '',
    srcLang: '',
    url: '',
  })

  const cancelButtonRef = useRef(null)

  useEffect(() => {
    // Initialize formState with record data
    const initialState = {
      tmdb_id: record?.metadata?.id || '',
      title: record?.title || '',
      videoURL: record?.videoURL || '',
      posterURL: record?.posterURL || '',
      posterBlurhash: record?.posterBlurhash || '',
      chapterURL: record?.chapterURL || '',
      logo: record?.logo || '',
      length: record?.length || '',
      dimensions: record?.dimensions || '',
      backdrop: record?.backdrop || '',
      backdropBlurhash: record?.backdropBlurhash || '',
      // Initialize other fields
    }
    setFormState(initialState)

    // Initialize lockedFields
    const recordLockedFields = record.lockedFields || {}
    setLockedFields(recordLockedFields)

    // Initialize captions
    if (record.captionURLs && typeof record.captionURLs === 'object') {
      const captionsArray = Object.entries(record.captionURLs).map(([label, { srcLang, url }]) => ({
        [label]: { srcLang, url },
      }))
      setCaptionStore(captionsArray)
    } else {
      setCaptionStore([])
    }

    // Reset userLockedFields when record changes
    setUserLockedFields({})
  }, [record])

  // Define field mappings with dynamic locking for tmdb_id
  const fieldMappings = {
    tmdb_id: {
      label: 'TMDB ID',
      placeholder: 'Enter TMDB ID',
      locked: !isAdding && !!record?.metadata?.id,
    },
    title: { label: 'Title', placeholder: 'Enter Title' },
    videoURL: { label: 'Video URL', placeholder: 'Enter Video URL' },
    posterURL: { label: 'Poster URL', placeholder: 'Enter Poster URL' },
    posterBlurhash: { label: 'Poster Blurhash URL', placeholder: 'Enter Poster Blurhash URL' },
    chapterURL: { label: 'Chapter URL', placeholder: 'Enter Chapter URL' },
    logo: { label: 'Logo', placeholder: 'Enter Logo Image URL' },
    length: { label: 'Length', placeholder: 'Enter length in ms of media' },
    dimensions: { label: 'Dimensions', placeholder: 'Enter dimensions of media' },
    backdrop: { label: 'Backdrop Image', placeholder: 'Enter backdrop image URL for media' },
    backdropBlurhash: {
      label: 'Backdrop Blurhash',
      placeholder: 'Enter backdrop blurhash URL for media',
    },
    // Add more mappings as needed
  }

  const posterURL = record.posterURL || getFullImageUrl(record?.metadata?.poster_path) || null

  const handleInputChange = (event) => {
    const { name, value } = event.target
    setFormState((prevState) => ({
      ...prevState,
      [name]: value,
    }))
  }

  // Function to toggle the lock state of a field
  const toggleFieldLock = (fieldKey) => {
    setLockedFields((prevLockedFields) => {
      const newLockedState = !prevLockedFields[fieldKey]
      // Update userLockedFields based on newLockedState
      setUserLockedFields((prevUserLockedFields) => {
        const updatedUserLockedFields = { ...prevUserLockedFields }
        if (newLockedState) {
          updatedUserLockedFields[fieldKey] = true
        } else {
          delete updatedUserLockedFields[fieldKey]
        }
        return updatedUserLockedFields
      })
      return {
        ...prevLockedFields,
        [fieldKey]: newLockedState,
      }
    })
  }

  const removeCaption = (indexToRemove) => {
    setCaptionStore((prevCaptions) => prevCaptions.filter((_, index) => index !== indexToRemove))
  }

  const handleNewCaptionChange = (event) => {
    const { name, value } = event.target
    setNewCaption((prevCaption) => ({ ...prevCaption, [name]: value }))
  }

  const addNewCaption = () => {
    const { label, srcLang, url } = newCaption
    const updatedCaption = {
      [newCaption.label]: {
        srcLang: newCaption.srcLang,
        url: newCaption.url,
      },
    }
    if (label && srcLang && url) {
      setCaptionStore((prevCaptions) => [...prevCaptions, updatedCaption])
      setNewCaption({ label: '', srcLang: '', url: '' })
    }
  }

  // Function to render input fields for each property in the record
  const renderInputFields = () => {
    return Object.entries(fieldMappings).map(([key, { label, placeholder, locked }]) => {
      const isInitiallyLocked = key === 'tmdb_id' && locked
      const isLocked = lockedFields[key] || locked
      const isUserLocked = userLockedFields[key]

      return (
        <div key={key} className="mt-4 flex flex-col">
          <label htmlFor={key} className="block text-sm font-medium text-gray-700 text-left mb-1">
            {label}
          </label>
          <div className="flex items-center">
            <input
              type="text"
              name={key}
              id={key}
              className={classNames(
                'grow mt-1 block w-full h-5 text-gray-600 border-gray-300 focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm',
                isLocked ? 'bg-gray-100 cursor-not-allowed' : ''
              )}
              value={formState[key]}
              onChange={handleInputChange}
              placeholder={placeholder}
              disabled={isLocked}
            />
            <button
              type="button"
              onClick={() => toggleFieldLock(key)}
              className="ml-2 focus:outline-none"
              title={isLocked ? 'Unlock field' : 'Lock field'}
              disabled={isInitiallyLocked} // Prevent toggling tmdb_id when it's initially locked
            >
              {isLocked ? (
                <LockClosedIcon className="h-5 w-5 text-gray-500" />
              ) : (
                <LockOpenIcon className="h-5 w-5 text-gray-500" />
              )}
            </button>
          </div>
          {/* Conditionally render hidden input if the field is locked by the user */}
          {isLocked && isUserLocked && (
            <>
              <input type="hidden" name={key} value={formState[key]} />
              {/* Optional: Add a visual indicator */}
              <span className="text-xs text-gray-500 ml-2"> (Locked and saved)</span>
            </>
          )}
        </div>
      )
    })
  }

  const renderCaptionURLsTable = () => {
    return (
      <div className="mt-4">
        <h3 className="block text-sm font-medium text-gray-700">Caption URLs</h3>
        <table className="min-w-full mt-2 divide-y divide-gray-200">
          <thead>
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Caption Label
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Source Language
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Caption URL
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {captionStore.length > 0 ? (
              captionStore.map((caption, index) => {
                const [label, { srcLang, url }] = Object.entries(caption)[0]
                return (
                  <tr key={`${index}-${label}`}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{label}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{srcLang}</td>
                    <td
                      title={url}
                      className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 truncate max-w-sm"
                    >
                      {url}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <button
                        onClick={() => removeCaption(index)}
                        className="text-indigo-600 hover:text-indigo-900"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                )
              })
            ) : (
              <tr>
                <td
                  colSpan="4"
                  className="px-6 py-4 whitespace-nowrap text-lg font-bold text-gray-500 text-center"
                >
                  No captions available
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    )
  }

  const renderNewCaptionInputs = () => {
    return (
      <div className="w-full mt-6">
        {/* Form for adding new captions */}
        <form>
          <h2 className="text-gray-600 text-lg font-bold mb-2">Subtitles</h2>
          <div className="grid grid-cols-4 gap-4 w-4/5 mx-auto">
            <input
              type="text"
              name="label"
              placeholder="Caption Label"
              className="text-gray-600 rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
              value={newCaption.label}
              onChange={handleNewCaptionChange}
            />
            <input
              type="text"
              name="srcLang"
              placeholder="Source Language"
              className="text-gray-600 rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
              value={newCaption.srcLang}
              onChange={handleNewCaptionChange}
            />
            <input
              type="text"
              name="url"
              placeholder="Caption URL"
              className="text-gray-600 rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
              value={newCaption.url}
              onChange={handleNewCaptionChange}
            />
            <button
              type="button"
              className="text-xs sm:text-sm rounded-md bg-indigo-600 px-3 py-2 font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
              onClick={addNewCaption}
            >
              Add Caption
            </button>
          </div>
        </form>
      </div>
    )
  }

  return (
    <Transition.Root show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-10" initialFocus={cancelButtonRef} onClose={setIsOpen}>
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
              <Dialog.Panel className="relative transform overflow-hidden rounded-lg bg-white px-4 pb-4 pt-5 text-left shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-6xl sm:p-6">
                <form action={saveMovieModalChanges}>
                  <div className={classNames(posterURL ? 'sm:flex sm:flex-row' : '')}>
                    <div
                      className={classNames(
                        posterURL
                          ? 'min-w-fit h-auto w-4/5 mr-4 rounded-lg max-w-sm'
                          : 'h-12 w-12 rounded-full',
                        'mx-auto flex items-center justify-center'
                      )}
                    >
                      {posterURL ? (
                        <img
                          src={posterURL}
                          alt={record.title}
                          className="h-auto w-full rounded-lg shadow-xl max-w-[384px]"
                        />
                      ) : (
                        <PencilSquareIcon className="h-6 w-6 text-blue-600" aria-hidden="true" />
                      )}
                    </div>
                    <div className="mt-3 text-center sm:mt-5 w-full">
                      <Dialog.Title
                        as="h3"
                        className="text-base font-semibold leading-6 text-gray-900"
                      >
                        {isAdding ? 'Adding New Movie' : `Editing ${record.title}`}
                      </Dialog.Title>
                      <div className="mt-2">
                        {renderInputFields()}
                        <hr className="mt-4" />
                        {renderNewCaptionInputs()}
                        {captionStore.length > 0 &&
                          captionStore.map((caption, index) => {
                            const captionJSON = JSON.stringify(caption)
                            return (
                              <input
                                key={index}
                                type="hidden"
                                name="captionURLs"
                                value={captionJSON}
                              />
                            )
                          })}
                        {Object.entries(lockedFields).map(([field, isLocked]) => (
                          <input
                            key={field}
                            type="hidden"
                            name={`locked_${field}`}
                            value={isLocked.toString()}
                          />
                        ))}
                        <input type="hidden" name="record" value={JSON.stringify(record)} />
                        <input type="hidden" name="type" value={record.type} />
                        {renderCaptionURLsTable()}
                      </div>
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
                      onClick={() => {
                        setIsOpen(false)
                      }}
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

export default memo(MovieModalPopup)
