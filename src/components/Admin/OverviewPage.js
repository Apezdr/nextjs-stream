'use client'

import { useEffect, useState } from 'react'
import ListRecords from './ListRecords'
import MovieModalPopup from './MovieModalPopup'
import TVModalPopup from './TVModalPopup'
import ConfirmDeletePopup from './ConfirmDeletePopup'
import { getRecord } from '../../utils/admin_frontend_database'
import SyncMediaPopup from './SyncMediaPopup'
import axios from 'axios'
import Link from 'next/link'
import RecentlyWatched from './RecentlyWatchedList'
import { buildURL } from '@src/utils'
import DownloadStatus from './Integrations/SABNZBDqueue'
import TdarrProgressBar from './Integrations/TdarrQueue'
import RadarrQueue from './Integrations/RadarrQueue'
import SonarrQueue from './Integrations/SonarrQueue'
import { PauseCircleIcon } from '@heroicons/react/20/solid'

const processLastSyncTimeData = (lastSyncTimeData) => {
  const lastSyncTime =
    typeof lastSyncTimeData === 'object'
      ? lastSyncTimeData?.lastSyncTime
        ? lastSyncTimeData.lastSyncTime
        : lastSyncTimeData
      : lastSyncTimeData
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

export default function AdminOverviewPage({
  processedData,
  processedUserData,
  _lastSyncTime,
  organizrURL,
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [isSyncOpen, setIsSyncOpen] = useState(false)
  const [isAdding, setIsAdding] = useState(null)
  const [record, setRecord] = useState(null)
  const [_processedData, setProcessedData] = useState(processedData)
  const [_processedUserData, setProcessedUserData] = useState(processedUserData)
  const [recentlyWatched, setRecentlyWatched] = useState(false)
  const [lastSyncTime, setLastSyncTime] = useState(() => processLastSyncTimeData(_lastSyncTime))
  const [sabnzbdQueue, setsabnzbdQueue] = useState(false)
  const [radarrQueue, setradarrQueue] = useState(false)
  const [sonarrQueue, setsonarrQueue] = useState(false)
  const [tdarrQueue, settdarrQueue] = useState(false)

  const updateRecord = (newData) => {
    setRecord((prevRecord) => ({ ...prevRecord, ...newData }))
  }

  const setLastSync = (lastSync) => processLastSyncTimeData(lastSync)

  const action = record && record.action

  const fetchRecentlyWatched = async () => {
    const response = await fetch(buildURL(`/api/authenticated/admin/recently-watched`))
    const data = await response.json()
    return data
  }

  const fetchLastSyncTime = async () => {
    const response = await fetch(buildURL(`/api/authenticated/admin/lastSynced`))
    const data = await response.json()
    return data
  }

  const fetchSABNZBDqueue = async () => {
    const response = await fetch(buildURL(`/api/authenticated/admin/sabnzbd`))
    const data = await response.json()
    return data
  }

  const fetchRadarrqueue = async () => {
    const response = await fetch(buildURL(`/api/authenticated/admin/radarr`))
    const data = await response.json()
    return data
  }

  const fetchSonarrqueue = async () => {
    const response = await fetch(buildURL(`/api/authenticated/admin/sonarr`))
    const data = await response.json()
    return data
  }

  const fetchTdarrqueue = async () => {
    const response = await fetch(buildURL(`/api/authenticated/admin/tdarr`))
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
    const fetchRecentlyWatchedData = async () => {
      try {
        const recentlyWatched = await fetchRecentlyWatched()
        setRecentlyWatched(recentlyWatched)
      } catch (error) {
        console.error('Error fetching data:', error)
      }
    }
    const fetchSABNZBDdata = async () => {
      try {
        const sabnzbdData = await fetchSABNZBDqueue()
        setsabnzbdQueue(sabnzbdData)
      } catch (error) {
        console.error('Error fetching SABNZBD queue:', error)
      }
    }
    const fetchRadarrdata = async () => {
      try {
        const radarrData = await fetchRadarrqueue()
        setradarrQueue(radarrData)
      } catch (error) {
        console.error('Error fetching Radarr queue:', error)
      }
    }
    const fetchSonarrdata = async () => {
      try {
        const sonarrData = await fetchSonarrqueue()
        setsonarrQueue(sonarrData)
      } catch (error) {
        console.error('Error fetching Sonarr queue:', error)
      }
    }
    const fetchTdarrdata = async () => {
      try {
        const tdarrData = await fetchTdarrqueue()
        settdarrQueue(tdarrData)
      } catch (error) {
        console.error('Error fetching Tdarr queue:', error)
      }
    }

    fetchData()

    const intervalId = setInterval(fetchData, 15000)
    const intervalId2 = setInterval(fetchRecentlyWatchedData, 2000)
    const intervalId3 = setInterval(fetchSABNZBDdata, 2000)
    const intervalId4 = setInterval(fetchRadarrdata, 2000)
    const intervalId5 = setInterval(fetchSonarrdata, 2000)
    const intervalId6 = setInterval(fetchTdarrdata, 2000)

    return () => {
      clearInterval(intervalId)
      clearInterval(intervalId2)
      clearInterval(intervalId3)
      clearInterval(intervalId4)
      clearInterval(intervalId5)
      clearInterval(intervalId6)
    }
  }, [])

  async function updateProcessedData(type) {
    let url = `/api/authenticated/admin`
    if (type === 'media') {
      url += '/media' // Append '/media' to the URL
    } else if (type === 'users') {
      url += '/users' // Append '/users' to the URL
    }

    const res = await axios.get(buildURL(url))
    const { processedData, processedUserData } = res.data

    if (type === 'media') {
      setProcessedData(processedData)
    } else if (type === 'users') {
      setProcessedUserData(processedUserData)
    } else {
      setProcessedData(processedData)
      setProcessedUserData(processedUserData)
    }
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
      {record && action !== 'delete' && record.type === 'movie' && (
        <MovieModalPopup
          record={record}
          updateRecord={updateRecord}
          isAdding={isAdding}
          isOpen={isOpen}
          setIsOpen={setIsOpen}
          updateProcessedData={updateProcessedData}
        />
      )}
      {record && action !== 'delete' && record.type === 'tv' && (
        <TVModalPopup
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
      <h1 className="block">Admin Page</h1>
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
      <RecentlyWatched recentlyWatched={recentlyWatched} />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {sabnzbdQueue ? (
          <div>
            <h2 className="text-xl font-bold mb-2">
              Download Status
              {sabnzbdQueue.queue.status?.toLowerCase() === 'paused' ? (
                <PauseCircleIcon className="ml-2 w-8 inline-block" />
              ) : null}
            </h2>
            <DownloadStatus data={sabnzbdQueue.queue} />
          </div>
        ) : null}
        {radarrQueue ? (
          <div>
            <h2 className="text-xl font-bold mb-2">Radarr Queue</h2>
            <RadarrQueue data={radarrQueue} />
          </div>
        ) : null}
        {sonarrQueue ? (
          <div>
            <h2 className="text-xl font-bold mb-2">Sonarr Queue</h2>
            <SonarrQueue data={sonarrQueue} />
          </div>
        ) : null}
        {tdarrQueue ? (
          <div>
            <h2 className="text-xl font-bold mb-2">Tdarr Progress</h2>
            <TdarrProgressBar data={tdarrQueue} />
          </div>
        ) : null}
      </div>
      <div className="flex flex-col xl:flex-row">
        <ListRecords
          title="Movies"
          subtitle="Overview of all movies"
          headers={_processedData.movies.headers}
          data={_processedData.movies.data}
          onEditClick={async (id) => {
            const record = await getRecord({ type: 'movie', id })
            setRecord({ type: 'movie', action: 'edit', ...record })
            setIsAdding(false)
            setIsOpen(true)
          }}
          onAddClick={() => {
            setRecord({ type: 'movie', action: 'add', title: '', videoURL: '' })
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
        <ListRecords
          title="TV Shows"
          subtitle="Overview of all TV shows"
          headers={_processedData.tvShows.headers}
          data={_processedData.tvShows.data}
          onEditClick={async (id) => {
            const record = await getRecord({ type: 'tv', id })
            setRecord({ type: 'tv', ...record })
            setIsAdding(false)
            setIsOpen(true)
          }}
          onAddClick={() => {
            setRecord({ type: 'tv', title: '', videoURL: '' })
            setIsAdding(true)
            setIsOpen(true)
          }}
          onDeleteClick={async (id) => {
            const record = await getRecord({ type: 'tv', id })
            setRecord({ type: 'tv', action: 'delete', ...record })
            setIsAdding(false)
            setIsOpen(true)
          }}
        />
      </div>
      <hr className="my-16 border-gray-300 w-full" />
      <div className="flex flex-col xl:flex-row w-full">
        <ListRecords
          title="Users"
          subtitle="Overview of all users"
          headers={_processedUserData.headers}
          data={_processedUserData.data}
          updateProcessedData={updateProcessedData}
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
