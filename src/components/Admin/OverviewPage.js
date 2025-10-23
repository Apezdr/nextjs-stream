'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import useSWR from 'swr'
import ListRecords from './ListRecords'
import MovieModalPopup from './MovieModalPopup'
import TVModalPopup from './TVModalPopup'
import ConfirmDeletePopup from './ConfirmDeletePopup'
import { getRecord } from '../../utils/admin_frontend_database'
import SyncMediaPopup from './SyncMediaPopup'
import axios from 'axios'
import Link from 'next/link'
import RecentlyWatched from './RecentlyWatchedList'
import EnhancedRecentlyWatched from './EnhancedRecentlyWatched'
import EnhancedQueueDashboard from './EnhancedQueueDashboard'
import CompactUserManagement from './CompactUserManagement'
import { buildURL, fetcher } from '@src/utils'
import WipeDbButton from '@src/app/(styled)/admin/WipeDBButton'
import EnhancedServerStats from './Stats/EnhancedServerStats'
import EnhancedServerProcesses from './Stats/EnhancedServerProcesses'
import { QueueDashboard } from './Integrations';
import { TMDBServerStatus } from './TMDBServerStatus';
import EnhancedTMDBStatus from './EnhancedTMDBStatus'
import DashboardHeader from './DashboardHeader'
import { MaterialCard, MaterialCardHeader, MaterialCardContent, MaterialButton } from './BaseComponents'

const processLastSyncTimeData = (lastSyncTimeData) => {
  const lastSyncTime =
    typeof lastSyncTimeData === 'object'
      ? lastSyncTimeData?.lastSyncTime
        ? lastSyncTimeData.lastSyncTime
        : lastSyncTimeData
      : lastSyncTimeData
  
  // Return the raw timestamp for DashboardHeader to process
  // DashboardHeader will handle the display formatting and categorization
  if (!isNaN(Date.parse(lastSyncTime)) && lastSyncTime) {
    return lastSyncTime
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
  const router = useRouter()
  const [isOpen, setIsOpen] = useState(false)
  const [isSyncOpen, setIsSyncOpen] = useState(false)
  const [isAdding, setIsAdding] = useState(null)
  const [record, setRecord] = useState(null)
  const [_processedData, setProcessedData] = useState(processedData)
  const [_processedUserData, setProcessedUserData] = useState(processedUserData)
  const [recentlyWatched, setRecentlyWatched] = useState(false)
  const [lastSyncTime, setLastSyncTime] = useState(() => processLastSyncTimeData(_lastSyncTime))
  const [sabnzbdQueue, setsabnzbdQueue] = useState(null)
  const [radarrQueue, setradarrQueue] = useState(null)
  const [sonarrQueue, setsonarrQueue] = useState(null)
  const [tdarrQueue, settdarrQueue] = useState(null)
  const [unsupportedQueues, setUnsupportedQueues] = useState([]) // Optional: To track unsupported queues

  // Track which queues are supported (used to disable SWR for unsupported queues)
  const [sabnzbdSupported, setSabnzbdSupported] = useState(true)
  const [radarrSupported, setRadarrSupported] = useState(true)
  const [sonarrSupported, setSonarrSupported] = useState(true)
  const [tdarrSupported, setTdarrSupported] = useState(true)

  // Queue fetcher that handles 501 responses
  const queueFetcher = async (url) => {
    const response = await fetch(url)
    if (response.status === 501) {
      return { __unsupported: true }
    }
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }
    return response.json()
  }

  // SWR hooks for data fetching
  const { data: lastSyncData } = useSWR(
    buildURL('/api/authenticated/admin/lastSynced'),
    fetcher,
    { refreshInterval: 15000 }
  )

  const { data: recentlyWatchedData } = useSWR(
    buildURL('/api/authenticated/admin/recently-watched'),
    fetcher,
    { refreshInterval: 2000 }
  )

  const { data: sabnzbdData } = useSWR(
    sabnzbdSupported ? buildURL('/api/authenticated/admin/sabnzbd') : null,
    queueFetcher,
    { refreshInterval: 2000 }
  )

  const { data: radarrData } = useSWR(
    radarrSupported ? buildURL('/api/authenticated/admin/radarr') : null,
    queueFetcher,
    { refreshInterval: 2000 }
  )

  const { data: sonarrData } = useSWR(
    sonarrSupported ? buildURL('/api/authenticated/admin/sonarr') : null,
    queueFetcher,
    { refreshInterval: 2000 }
  )

  const { data: tdarrData } = useSWR(
    tdarrSupported ? buildURL('/api/authenticated/admin/tdarr') : null,
    queueFetcher,
    { refreshInterval: 2000 }
  )

  const updateRecord = (newData) => {
    setRecord((prevRecord) => ({ ...prevRecord, ...newData }))
  }

  const setLastSync = (lastSync) => {
    const processedTime = processLastSyncTimeData(lastSync)
    setLastSyncTime(processedTime)
  }

  const action = record && record.action

  // Map SWR data to component state
  useEffect(() => {
    if (lastSyncData) {
      const formattedTime = processLastSyncTimeData(lastSyncData)
      setLastSyncTime(formattedTime)
    }
  }, [lastSyncData])

  useEffect(() => {
    if (recentlyWatchedData) {
      setRecentlyWatched(recentlyWatchedData)
    }
  }, [recentlyWatchedData])

  useEffect(() => {
    if (sabnzbdData) {
      if (sabnzbdData.__unsupported) {
        setSabnzbdSupported(false)
        setUnsupportedQueues((prev) => [...prev, 'SABNZBD'])
        console.warn('SABNZBD not supported. Stopping polling.')
      } else {
        setsabnzbdQueue(sabnzbdData)
      }
    }
  }, [sabnzbdData])

  useEffect(() => {
    if (radarrData) {
      if (radarrData.__unsupported) {
        setRadarrSupported(false)
        setUnsupportedQueues((prev) => [...prev, 'Radarr'])
        console.warn('Radarr not supported. Stopping polling.')
      } else {
        setradarrQueue(radarrData)
      }
    }
  }, [radarrData])

  useEffect(() => {
    if (sonarrData) {
      if (sonarrData.__unsupported) {
        setSonarrSupported(false)
        setUnsupportedQueues((prev) => [...prev, 'Sonarr'])
        console.warn('Sonarr not supported. Stopping polling.')
      } else {
        setsonarrQueue(sonarrData)
      }
    }
  }, [sonarrData])

  useEffect(() => {
    if (tdarrData) {
      if (tdarrData.__unsupported) {
        setTdarrSupported(false)
        setUnsupportedQueues((prev) => [...prev, 'Tdarr'])
        console.warn('Tdarr not supported. Stopping polling.')
      } else {
        settdarrQueue(tdarrData)
      }
    }
  }, [tdarrData])

  async function updateProcessedData(type) {
    let url = `/api/authenticated/admin`
    if (type === 'media') {
      url += '/media'
    } else if (type === 'users') {
      url += '/users'
    }

    const maxRetries = 3
    let retries = 0

    while (retries < maxRetries) {
      try {
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

        return // Success, exit the function
      } catch (error) {
        retries++
        if (retries === maxRetries) {
          console.error(`Failed to fetch data after ${maxRetries} attempts:`, error)
          throw error // Rethrow the error if all retries fail
        }
        await new Promise((resolve) => setTimeout(resolve, 1000 * retries)) // Wait before retrying
      }
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Modals */}
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

        {/* Dashboard Header */}
        <DashboardHeader
          onSyncClick={() => setIsSyncOpen(true)}
          lastSyncTime={lastSyncTime}
          organizrURL={organizrURL}
        />

        {/* Main Dashboard Grid */}
        <div className="space-y-8">
          {/* System Status Section */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Server Statistics */}
            <MaterialCard elevation="medium" className="h-fit">
              <MaterialCardHeader
                title="Server Resources"
                subtitle="Real-time CPU and memory usage"
                icon={
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                }
              />
              <MaterialCardContent padding="none">
                <EnhancedServerStats />
              </MaterialCardContent>
            </MaterialCard>

            {/* Server Processes */}
            <MaterialCard elevation="medium" className="h-fit">
              <MaterialCardHeader
                title="Active Processes"
                subtitle="Currently running server tasks"
                icon={
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                }
              />
              <MaterialCardContent padding="none">
                <EnhancedServerProcesses />
              </MaterialCardContent>
            </MaterialCard>
          </div>

          {/* Services Section */}
          <div className="space-y-6">
            {/* TMDB Server Status */}
            <EnhancedTMDBStatus />

            {/* Media Processing Queues */}
            <MaterialCard elevation="medium">
              <MaterialCardContent>
                <EnhancedQueueDashboard
                  sabnzbdQueue={sabnzbdQueue}
                  radarrQueue={radarrQueue}
                  sonarrQueue={sonarrQueue}
                  tdarrQueue={tdarrQueue}
                  unsupportedQueues={unsupportedQueues}
                />
              </MaterialCardContent>
            </MaterialCard>

            {/* Unsupported Queues Warning */}
            {unsupportedQueues.length > 0 && (
              <MaterialCard variant="outlined" elevation="low">
                <MaterialCardHeader
                  title="Unsupported Integrations"
                  icon={
                    <svg className="w-6 h-6 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.998-.833-2.768 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
                    </svg>
                  }
                />
                <MaterialCardContent>
                  <ul className="space-y-1 text-sm text-orange-700">
                    {[...new Set(unsupportedQueues)].map((queue) => (
                      <li key={queue} className="flex items-center space-x-2">
                        <span className="w-2 h-2 bg-orange-400 rounded-full"></span>
                        <span>{queue} is not supported</span>
                      </li>
                    ))}
                  </ul>
                </MaterialCardContent>
              </MaterialCard>
            )}
          </div>

          {/* Activity & Management Section */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            {/* Recently Watched - Takes up 2 columns */}
            <div className="xl:col-span-2">
              <MaterialCard elevation="medium" className="h-full">
                <MaterialCardHeader
                  title="Recent Activity"
                  subtitle="Live user watching activity"
                  icon={
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  }
                />
                <MaterialCardContent>
                  <EnhancedRecentlyWatched recentlyWatched={recentlyWatched} />
                </MaterialCardContent>
              </MaterialCard>
            </div>

            {/* User Management - Takes up 1 column */}
            <div className="xl:col-span-1">
              <MaterialCard elevation="medium" className="h-full">
                <MaterialCardHeader
                  title="User Management"
                  subtitle="System users overview"
                  icon={
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width={23}
                      height={23}
                      viewBox="0 0 512 512"
                      fill="currentColor"
                      stroke="none"
                    >
                      <path
                        fillRule="evenodd"
                        d="M200.876 277.332c-5.588 12.789-8.74 26.884-8.872 41.7L192 320v128H64v-85.333c0-46.676 37.427-84.569 83.922-85.322l1.411-.012h51.543Zm161.79-42.665C409.796 234.667 448 272.872 448 320v128H213.333V320c0-47.128 38.205-85.333 85.334-85.333h64ZM170.667 128c35.286 0 64 28.715 64 64s-28.714 64-64 64c-35.285 0-64-28.715-64-64s28.715-64 64-64Zm160-64c41.174 0 74.667 33.493 74.667 74.667 0 41.173-33.493 74.666-74.666 74.666-41.174 0-74.667-33.493-74.667-74.666C256 97.493 289.493 64 330.667 64Z"
                      />
                    </svg>
                  }
                  action={
                    <Link href="/admin/users">
                      <MaterialButton
                        variant="text"
                        size="small"
                        color="primary"
                      >
                        View All
                      </MaterialButton>
                    </Link>
                  }
                />
                <MaterialCardContent>
                  <CompactUserManagement
                    headers={_processedUserData.headers}
                    data={_processedUserData.data}
                    updateProcessedData={updateProcessedData}
                    onViewAll={() => router.push('/admin/users')}
                  />
                </MaterialCardContent>
              </MaterialCard>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function isSameDay(date1, date2) {
  return (
    date1.getFullYear() === date2.getFullYear() &&
    date1.getMonth() === date2.getMonth() &&
    date1.getDate() === date2.getDate()
  )
}
