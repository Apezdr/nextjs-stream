'use client'
import { memo, useState } from 'react'
import { Dialog } from '@headlessui/react'
import { QuestionMarkCircleIcon, XMarkIcon } from '@heroicons/react/24/outline' // Optional: For icons
import NodeJSDocumentation from './ServerInfo/NodeJSDocumentation'

function ServerList({
  fileServerURL,
  fileServerPrefixPath,
  organizrURL,
  nodeJSURL,
  syncTVURL,
  syncMoviesURL,
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [modalContent, setModalContent] = useState({ label: '', info: '' })

  const settings = [
    {
      label: 'File Server URL',
      value: fileServerURL,
      info: 'This is the base URL for your File Server. Ensure it is correctly configured in your Docker setup.',
    },
    {
      label: 'File Server Prefix',
      value: fileServerPrefixPath,
      info: 'The prefix path for accessing files on the File Server. This should match your server configuration.',
    },
    {
      label: 'Organizr URL',
      value: organizrURL,
      info: 'URL for Organizr, which manages your web services. Make sure it points to the correct Organizr instance.',
    },
    {
      label: 'NodeJS URL',
      value: nodeJSURL,
      info: <NodeJSDocumentation nodeJSURL={nodeJSURL} />,
    },
    {
      label: 'Sync TV URL',
      value: syncTVURL,
      info: 'URL used to synchronize TV data. The NodeJS service serves this data.',
    },
    {
      label: 'Sync Movies URL',
      value: syncMoviesURL,
      info: 'URL used to synchronize movie data. The NodeJS service serves this data.',
    },
  ]

  const openModal = (label, info) => {
    setModalContent({ label, info })
    setIsOpen(true)
  }

  const closeModal = () => {
    setIsOpen(false)
  }

  return (
    <div>
      <h2 className="text-base font-semibold leading-7 text-gray-900">Server Settings</h2>
      <p className="mt-1 text-sm leading-6 text-gray-500">
        Configure your server settings inside your Docker configuration.
      </p>

      <dl className="mt-6 space-y-6 divide-y divide-gray-100 border-t border-gray-200 text-sm leading-6">
        <div className="pt-6 sm:flex flex-col divide-y">
          {settings.map(({ label, value, info }) => (
            <div key={label} className="sm:flex sm:items-center sm:w-full py-4">
              <dt className="font-medium text-gray-900 sm:w-64 sm:flex-none sm:pr-2 flex items-center">
                {label}
              </dt>
              <dd className="mt-1 sm:mt-0 flex flex-row">
                <div className="text-gray-900 truncate w-full" title={value}>
                  {value}
                </div>
                <div>
                  {info && (
                    <button
                      type="button"
                      onClick={() => openModal(label, info)}
                      className="ml-2 text-gray-500 hover:text-gray-700 focus:outline-none"
                      aria-label={`More info about ${label}`}
                    >
                      <QuestionMarkCircleIcon className="h-5 w-5 inline" />
                    </button>
                  )}
                </div>
                {/* You can uncomment and implement the "Change" button if needed */}
                {/* <button
                  type="button"
                  // onClick={() => alert('You must change this in the docker compose file.')}
                  className="ml-2 text-indigo-600 hover:text-indigo-900"
                >
                  Change
                </button> */}
              </dd>
            </div>
          ))}
        </div>
        {/* Other server settings can be added here if needed */}
      </dl>

      {/* Modal */}
      <Dialog open={isOpen} onClose={closeModal} className="relative z-50">
        <div className="fixed inset-0 bg-black/30" aria-hidden="true" />

        <div className="fixed inset-0 flex items-center justify-center p-4">
          <Dialog.Panel className="mx-auto max-w-md lg:max-w-7xl flex flex-col h-auto rounded bg-white p-6 shadow-lg">
            <div className="flex justify-between items-start">
              <Dialog.Title className="text-lg font-medium text-gray-900">
                {modalContent.label} Information
              </Dialog.Title>
              <button
                type="button"
                className="text-gray-400 hover:text-gray-600 focus:outline-none"
                onClick={closeModal}
              >
                <XMarkIcon className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            <div className="mt-4 overflow-auto h-5/6 text-sm text-gray-500 max-h-[80vh]">
              {modalContent.info}
            </div>
            <div className="mt-6 flex justify-end">
              <button
                type="button"
                className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 focus:outline-none"
                onClick={closeModal}
              >
                Close
              </button>
            </div>
          </Dialog.Panel>
        </div>
      </Dialog>
    </div>
  )
}

export default memo(ServerList)
