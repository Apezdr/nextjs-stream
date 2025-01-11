'use client'
import { memo, useState } from 'react'
import { Dialog } from '@headlessui/react'
import { QuestionMarkCircleIcon, XMarkIcon } from '@heroicons/react/24/outline' // Optional: For icons
import NodeJSDocumentation from './ServerInfo/NodeJSDocumentation'
import PropTypes from 'prop-types'

function ServerList({ servers, organizrURL }) {
  const [isOpen, setIsOpen] = useState(false)
  const [modalContent, setModalContent] = useState({ label: '', info: '' })

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
        Below are the server settings dynamically fetched from the configuration.
      </p>

      <div className="mt-6 space-y-8 divide-y divide-gray-200">
        {/* Iterate through each server and render its settings */}
        {servers.map((server, index) => (
          <div key={server.id} className="pt-6">
            {/* Server Header */}
            <h3 className="text-lg font-medium text-gray-800 mb-4">
              Server: <span className="font-semibold">{server.id}</span>
            </h3>

            <dl className="space-y-6">
              {/* File Server URL */}
              <div className="flex flex-col md:flex-row items-center justify-between">
                <dt className="font-medium text-gray-900">File Server URL</dt>
                <dd className="flex items-center space-x-2">
                  <span className="text-gray-900 truncate" title={server.baseURL}>
                    {server.baseURL}
                  </span>
                  <button
                    type="button"
                    onClick={() => openModal(`File Server URL (${server.id})`, `This is the base URL for the ${server.id} File Server. Ensure it is correctly configured in your Docker setup.`)}
                    className="text-gray-500 hover:text-gray-700 focus:outline-none"
                    aria-label={`More info about File Server URL (${server.id})`}
                  >
                    <QuestionMarkCircleIcon className="h-5 w-5" />
                  </button>
                </dd>
              </div>

              {/* File Server Prefix Path */}
              <div className="flex flex-col md:flex-row items-center justify-between">
                <dt className="font-medium text-gray-900">File Server Prefix Path</dt>
                <dd className="flex items-center space-x-2">
                  <span className="text-gray-900 truncate" title={server.prefixPath || 'None'}>
                    {server.prefixPath || 'None'}
                  </span>
                  <button
                    type="button"
                    onClick={() => openModal(`File Server Prefix Path (${server.id})`, `The prefix path for accessing files on the ${server.id} File Server. This should match your server configuration.`)}
                    className="text-gray-500 hover:text-gray-700 focus:outline-none"
                    aria-label={`More info about File Server Prefix Path (${server.id})`}
                  >
                    <QuestionMarkCircleIcon className="h-5 w-5" />
                  </button>
                </dd>
              </div>

              {/* NodeJS URL */}
              <div className="flex flex-col md:flex-row items-center justify-between">
                <dt className="font-medium text-gray-900">NodeJS URL</dt>
                <dd className="flex items-center space-x-2">
                  <span className="text-gray-900 truncate" title={server.syncEndpoint}>
                    {server.syncEndpoint}
                  </span>
                  <button
                    type="button"
                    onClick={() => openModal(`NodeJS URL (${server.id})`, <NodeJSDocumentation nodeJSURL={server.syncEndpoint} />)}
                    className="text-gray-500 hover:text-gray-700 focus:outline-none"
                    aria-label={`More info about NodeJS URL (${server.id})`}
                  >
                    <QuestionMarkCircleIcon className="h-5 w-5" />
                  </button>
                </dd>
              </div>

              {/* Sync TV URL */}
              <div className="flex flex-col md:flex-row items-center justify-between">
                <dt className="font-medium text-gray-900">Sync TV URL</dt>
                <dd className="flex items-center space-x-2">
                  <span className="text-gray-900 truncate" title={server.paths?.sync?.tv || 'Not Provided'}>
                    {server.paths?.sync?.tv || 'Not Provided'}
                  </span>
                  <button
                    type="button"
                    onClick={() => openModal(`Sync TV URL (${server.id})`, `URL for synchronizing TV data on the ${server.id} server.`)}
                    className="text-gray-500 hover:text-gray-700 focus:outline-none"
                    aria-label={`More info about Sync TV URL (${server.id})`}
                  >
                    <QuestionMarkCircleIcon className="h-5 w-5" />
                  </button>
                </dd>
              </div>

              {/* Sync Movies URL */}
              <div className="flex flex-col md:flex-row items-center justify-between">
                <dt className="font-medium text-gray-900">Sync Movies URL</dt>
                <dd className="flex items-center space-x-2">
                  <span className="text-gray-900 truncate" title={server.paths?.sync?.movies || 'Not Provided'}>
                    {server.paths?.sync?.movies || 'Not Provided'}
                  </span>
                  <button
                    type="button"
                    onClick={() => openModal(`Sync Movies URL (${server.id})`, `URL for synchronizing Movies data on the ${server.id} server.`)}
                    className="text-gray-500 hover:text-gray-700 focus:outline-none"
                    aria-label={`More info about Sync Movies URL (${server.id})`}
                  >
                    <QuestionMarkCircleIcon className="h-5 w-5" />
                  </button>
                </dd>
              </div>
            </dl>

            {/* Add a divider between servers, except after the last server */}
            {/* {index < servers.length - 1 && <hr className="mt-6 border-gray-300" />} */}
          </div>
        ))}

        {/* Global Settings Section */}
        <div className="pt-6">
          <h3 className="text-lg font-medium text-gray-800 mb-4">Global Settings</h3>
          <dl className="space-y-6">
            {/* Organizr URL */}
            <div className="flex flex-col md:flex-row items-center justify-between">
              <dt className="font-medium text-gray-900">Organizr URL</dt>
              <dd className="flex items-center space-x-2">
                <span className="text-gray-900 truncate" title={organizrURL}>
                  {organizrURL}
                </span>
                <button
                  type="button"
                  onClick={() => openModal('Organizr URL', 'URL for Organizr, which manages your web services.')}
                  className="text-gray-500 hover:text-gray-700 focus:outline-none"
                  aria-label="More info about Organizr URL"
                >
                  <QuestionMarkCircleIcon className="h-5 w-5" />
                </button>
              </dd>
            </div>
          </dl>
        </div>
      </div>

      {/* Modal */}
      <Dialog open={isOpen} onClose={closeModal} className="relative z-50">
        <div className="fixed inset-0 bg-black/30" aria-hidden="true" />
        <div className="fixed inset-0 flex items-center justify-center p-4">
          <Dialog.Panel className="mx-auto max-w-md lg:max-w-7xl flex flex-col h-auto rounded bg-white p-6 shadow-lg">
            <div className="flex justify-between items-start">
              <Dialog.Title className="text-lg font-medium text-gray-900">
                {typeof modalContent.info === 'string' ? `${modalContent.label} Information` : `${modalContent.label} Information`}
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

ServerList.propTypes = {
  servers: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.string.isRequired,
      baseURL: PropTypes.string.isRequired,
      prefixPath: PropTypes.string,
      syncEndpoint: PropTypes.string.isRequired,
      paths: PropTypes.shape({
        sync: PropTypes.shape({
          tv: PropTypes.string,
          movies: PropTypes.string,
        }),
      }),
    })
  ).isRequired,
  organizrURL: PropTypes.string.isRequired,
}

export default memo(ServerList)
