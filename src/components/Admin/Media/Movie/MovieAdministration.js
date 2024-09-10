'use client'

import { useEffect, useState } from 'react'
import ListRecords from '../../ListRecords'
import MovieModalPopup from '../../MovieModalPopup'
import ConfirmDeletePopup from '../../ConfirmDeletePopup'
import { getRecord } from '../../../../utils/admin_frontend_database'
import SyncMediaPopup from '../../SyncMediaPopup'
import axios from 'axios'
import Link from 'next/link'
import { buildURL } from '@src/utils'

const processLastSyncTimeData = (lastSyncTimeData) => {
  const lastSyncTime =
    typeof lastSyncTimeData === 'object' ? lastSyncTimeData?.lastSyncTime : lastSyncTimeData
  if (!isNaN(Date.parse(lastSyncTime)) && lastSyncTime) {
    const lastSyncDate = new Date(lastSyncTime)
    const formattedTime = isSameDay(new Date(), lastSyncDate)
      ? `Today at ${lastSyncDate.toLocaleString('en-US', {
          hour: 'numeric',
          minute: 'numeric',
          second: 'numeric',
          hour12: true,
        })}`
      : lastSyncDate.toLocaleString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          hour: 'numeric',
          minute: 'numeric',
          second: 'numeric',
          hour12: true,
        })
    return String(formattedTime)
  } else {
    return "Sync hasn't been run yet"
  }
}

export default function MovieAdministration({ processedData, _lastSyncTime, organizrURL }) {
  const [isOpen, setIsOpen] = useState(false)
  const [isSyncOpen, setIsSyncOpen] = useState(false)
  const [isAdding, setIsAdding] = useState(null)
  const [record, setRecord] = useState(null)
  const [_processedData, setProcessedData] = useState(processedData)
  const [lastSyncTime, setLastSyncTime] = useState(() => processLastSyncTimeData(_lastSyncTime))

  const updateRecord = (newData) => {
    setRecord((prevRecord) => ({ ...prevRecord, ...newData }))
  }

  const setLastSync = (lastSync) => processLastSyncTimeData(lastSync)

  const action = record && record.action

  const fetchLastSyncTime = async () => {
    const response = await fetch(buildURL(`/api/authenticated/admin/lastSynced`))
    const data = await response.json()
    return data
  }

  useEffect(() => {
    const fetchData = async () => {
      try {
        const lastSyncTimeData = await fetchLastSyncTime()
        const formattedTime = processLastSyncTimeData(lastSyncTimeData)
        setLastSyncTime(formattedTime)
      } catch (error) {
        console.error('Error fetching data:', error)
      }
    }

    fetchData()

    const intervalId = setInterval(fetchData, 15000)

    return () => {
      clearInterval(intervalId)
    }
  }, [])

  async function updateProcessedData() {
    const res = await axios.get(buildURL('/api/authenticated/admin/media'))
    const { processedData } = res.data
    setProcessedData(processedData)
  }

  return (
    <>
      {isSyncOpen && (
        <SyncMediaPopup
          isOpen={isSyncOpen}
          setIsOpen={setIsSyncOpen}
          updateProcessedData={updateProcessedData}
          setLastSync={setLastSync}
        />
      )}
      {record && action !== 'delete' && (
        <MovieModalPopup
          record={record}
          updateRecord={updateRecord}
          isAdding={isAdding}
          isOpen={isOpen}
          setIsOpen={setIsOpen}
          updateProcessedData={updateProcessedData}
        />
      )}
      {record && action === 'delete' && (
        <ConfirmDeletePopup
          record={record}
          updateRecord={updateRecord}
          isAdding={isAdding}
          isOpen={isOpen}
          setIsOpen={setIsOpen}
          updateProcessedData={updateProcessedData}
        />
      )}
      <h1 className="block">Movie Administration</h1>
      <div className="bg-white shadow-md rounded-lg">
        <div className="bg-red-500 text-white flex flex-row justify-center rounded-t-md select-none">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
            className="w-6 h-6"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9.348 14.652a3.75 3.75 0 0 1 0-5.304m5.304 0a3.75 3.75 0 0 1 0 5.304m-7.425 2.121a6.75 6.75 0 0 1 0-9.546m9.546 0a6.75 6.75 0 0 1 0 9.546M5.106 18.894c-3.808-3.807-3.808-9.98 0-13.788m13.788 0c3.808 3.807 3.808 9.98 0 13.788M12 12h.008v.008H12V12Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z"
            />
          </svg>
          <span className="ml-1">LIVE</span>
        </div>
        <div className="px-6 pb-6 pt-3">
          <div className="flex items-center justify-center">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-6 w-6 text-blue-500 mr-2"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <span className="text-lg font-semibold text-black">Last Synced:</span>
          </div>
          <p className="mt-2 text-gray-600">{lastSyncTime}</p>
        </div>
      </div>
      <div className="flex flex-row gap-4 mt-8">
        <button
          type="button"
          className="block rounded bg-indigo-600 px-2 py-1 text-base font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
          onClick={() => setIsSyncOpen(true)}
        >
          Sync with Fileserver
        </button>
        <Link
          className="block rounded bg-indigo-600 px-2 py-1 text-base font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
          href={organizrURL}
          target="_blank"
        >
          Organizr
        </Link>
      </div>
      <hr className="my-16 border-gray-300 w-full" />
      <div className="flex flex-col xl:flex-row">
        <ListRecords
          title={`${_processedData.movies ? `(${_processedData.movies?.data.length}) ` : ``}Movies`}
          subtitle="Overview of all movies"
          headers={_processedData.movies?.headers}
          data={_processedData.movies?.data}
          onEditClick={async (id) => {
            const record = await getRecord({ type: 'movie', id })
            setRecord({ type: 'movie', ...record })
            setIsAdding(false)
            setIsOpen(true)
          }}
          onAddClick={() => {
            setRecord({ type: 'movie', title: '', videoURL: '' })
            setIsAdding(true)
            setIsOpen(true)
          }}
          onDeleteClick={async (id) => {
            const record = await getRecord({ type: 'movie', id })
            setRecord({ type: 'movie', action: 'delete', ...record })
            setIsAdding(false)
            setIsOpen(true)
          }}
        />
      </div>
    </>
  )
}

function isSameDay(date1, date2) {
  return (
    date1.getFullYear() === date2.getFullYear() &&
    date1.getMonth() === date2.getMonth() &&
    date1.getDate() === date2.getDate()
  )
}
