'use client'
import { Fragment, useEffect, useRef, useState } from 'react'
import { Dialog, Transition } from '@headlessui/react'
import { PencilSquareIcon } from '@heroicons/react/24/outline'
import { saveMovieModalChanges } from '../../utils/admin_frontend_database'
import { classNames } from '../../utils'

export default function MovieModalPopup({
  record,
  updateRecord,
  isAdding,
  isOpen,
  setIsOpen,
  updateProcessedData,
}) {
  // Local state for managing new caption inputs
  const [newCaption, setNewCaption] = useState({
    label: '',
    srcLang: '',
    url: '',
  })
  const [caption_store, setCaption_store] = useState([])

  useEffect(() => {
    setNewCaption({
      label: '',
      srcLang: '',
      url: '',
    })
    // Check if captionURLs exists and is an object
    if (record.captionURLs && typeof record.captionURLs === 'object') {
      // Transform the object into an array of objects
      const captionUrlsArray = Object.entries(record.captionURLs).map(
        ([label, { srcLang, url }]) => ({
          [label]: { srcLang, url },
        })
      )
      setCaption_store(captionUrlsArray)
    } else {
      // If captionURLs is not an object, set an empty array
      setCaption_store([])
    }
  }, [record])

  const fieldMappings = {
    title: { label: 'Title', placeholder: 'Enter Label' },
    videoURL: { label: 'Video URL', placeholder: 'Enter Video URL' },
    posterURL: { label: 'Poster URL', placeholder: 'Enter Poster URL' },
    posterBlurhash: { label: 'Poster Blurhash URL', placeholder: 'Enter Poster Blurhash URL' },
    chapterURL: { label: 'Chapter URL', placeholder: 'Enter Chapter URL' },
    // Add more mappings as needed
  }

  const cancelButtonRef = useRef(null)

  const removeCaption = (indexToRemove) => {
    setCaption_store((prevCaptions) => prevCaptions.filter((_, index) => index !== indexToRemove))
  }

  // Function to render input fields for each property in the record
  const renderInputFields = () => {
    // Ensure posterURL is always included
    const modifiedRecord = { ...record }
    if (!modifiedRecord.posterURL) {
      modifiedRecord.posterURL = '' // Default value for posterURL if not present
    }
    if (!modifiedRecord.posterBlurhash) {
      modifiedRecord.posterBlurhash = '' // Default value for posterURL if not present
    }
    return Object.entries(modifiedRecord).map(([key, value]) => {
      // Exclude _id and metadata fields
      if (
        key !== '_id' &&
        key !== 'metadata' &&
        key !== 'captionURLs' &&
        key !== 'type' &&
        key !== 'action'
      ) {
        // Check if the value is an object (for nested properties like captionURLs)
        if (typeof value === 'object' && value !== null) {
          return Object.entries(value).map(([nestedKey, nestedValue]) => (
            <div key={nestedKey} className="mt-4">
              <label htmlFor={nestedKey} className="block text-sm font-medium text-gray-700">
                {nestedKey}
              </label>
              <input
                type="text"
                name={nestedKey}
                id={nestedKey}
                className="mt-1 block w-full h-5 text-gray-600 border-gray-300 focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                defaultValue={JSON.stringify(nestedValue)}
              />
            </div>
          ))
        }
        const { label, placeholder } = fieldMappings[key] || {
          label: key,
          placeholder: `Enter ${key}`,
        }
        return (
          <div key={key} className="mt-4">
            <label htmlFor={key} className="block text-sm font-medium text-gray-700 text-left">
              {label}
            </label>
            <input
              type="text"
              name={key}
              id={key}
              className="mt-1 block w-full h-5 text-gray-600 border-gray-300 focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
              defaultValue={value}
              placeholder={placeholder}
            />
          </div>
        )
      }
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
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {caption_store && caption_store.length > 0 ? (
              caption_store.map((caption, index) =>
                Object.entries(caption).map(([label, { srcLang, url }]) => (
                  <tr key={index + label}>
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
                ))
              )
            ) : (
              <tr>
                <td
                  colSpan="3"
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

  const handleNewCaptionChange = (event) => {
    const { name, value } = event.target
    setNewCaption((prevCaption) => ({ ...prevCaption, [name]: value || '' }))
  }

  const addNewCaption = () => {
    if (newCaption.label !== '' && newCaption.srcLang !== '' && newCaption.url !== '') {
      const updatedCaption = {
        [newCaption.label]: {
          srcLang: newCaption.srcLang,
          url: newCaption.url,
        },
      }
      setCaption_store((prevCaptionStore) => [...prevCaptionStore, updatedCaption])
      //updateRecord(updatedRecord);
      // Reset the input fields after adding a new caption
      setNewCaption({ label: '', srcLang: '', url: '' })
    }
  }

  const renderNewCaptionInputs = () => {
    return (
      <div className="w-full mt-6">
        {/* Wrap in a form to prevent it from populating empty or non-appended fields. */}
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
              <Dialog.Panel className="relative transform overflow-hidden rounded-lg bg-white px-4 pb-4 pt-5 text-left shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-6xl sm:p-6">
                <form action={saveMovieModalChanges}>
                  <div className={classNames(record.posterURL ? 'sm:flex sm:flex-row' : '')}>
                    <div
                      className={classNames(
                        record.posterURL
                          ? 'min-w-fit h-auto w-4/5 mr-4 rounded-lg max-w-sm'
                          : 'h-12 w-12 rounded-full',
                        'mx-auto flex items-center justify-center'
                      )}
                    >
                      {record.posterURL ? (
                        <img
                          src={record.posterURL}
                          alt={record.title}
                          className="h-auto w-full rounded-lg shadow-xl max-w-[384px]"
                        />
                      ) : (
                        <PencilSquareIcon className="h-6 w-6 text-blue-600" aria-hidden="true" />
                      )}
                    </div>
                    <div className="mt-3 text-center sm:mt-5">
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
                        {caption_store.length > 0 &&
                          caption_store.map((caption, index) => (
                            <input
                              key={index}
                              type="hidden"
                              name="captionURLs"
                              value={JSON.stringify(caption)}
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
