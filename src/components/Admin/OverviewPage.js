'use client'

import { useReducer, useState } from 'react'
import { useRouter } from 'next/navigation'
import useSWR from 'swr'
import SyncMediaPopup from './SyncMediaPopup'
import axios from 'axios'
import Link from 'next/link'
import EnhancedRecentlyWatched from './EnhancedRecentlyWatched'
import EnhancedQueueDashboard from './EnhancedQueueDashboard'
import CompactUserManagement from './CompactUserManagement'
import { buildURL, fetcher } from '@src/utils'
import EnhancedServerStats from './Stats/EnhancedServerStats'
import EnhancedServerProcesses from './Stats/EnhancedServerProcesses'
import EnhancedTMDBStatus from './EnhancedTMDBStatus'
import DashboardHeader from './DashboardHeader'
import { MaterialCard, MaterialCardHeader, MaterialCardContent, MaterialButton } from './BaseComponents'

function processLastSyncTimeData(lastSyncTimeData) {
  const lastSyncTime =
    typeof lastSyncTimeData === 'object'
      ? lastSyncTimeData?.lastSyncTime
        ? lastSyncTimeData.lastSyncTime
        : lastSyncTimeData
      : lastSyncTimeData

  if (!isNaN(Date.parse(lastSyncTime)) && lastSyncTime) {
    return lastSyncTime
  } else {
    return "Sync hasn't been run yet"
  }
}

const initialPopupState = {
  isSyncOpen: false,
  syncAutoConnect: false,
}

function popupReducer(state, action) {
  switch (action.type) {
    case 'setIsSyncOpen':
      return { ...state, isSyncOpen: action.value }
    case 'setSyncAutoConnect':
      return { ...state, syncAutoConnect: action.value }
    default:
      return state
  }
}

export default function AdminOverviewPage({
  processedUserData,
  _lastSyncTime,
  organizrURL,
}) {
  const router = useRouter()
  const [popupState, dispatch] = useReducer(popupReducer, initialPopupState)
  const { isSyncOpen, syncAutoConnect } = popupState

  const setIsSyncOpen = (value) => dispatch({ type: 'setIsSyncOpen', value })
  const setSyncAutoConnect = (value) => dispatch({ type: 'setSyncAutoConnect', value })

  const [_processedUserData, setProcessedUserData] = useState(() => processedUserData)

  // SWR hooks — data used directly, no intermediate state or effects.
  // The media queues poll inside EnhancedQueueDashboard, so their updates
  // re-render that panel rather than this whole page.
  const { data: lastSyncData, mutate: mutateLastSync } = useSWR(
    buildURL('/api/authenticated/admin/lastSynced'),
    fetcher,
    { refreshInterval: 15000 }
  )

  const { data: recentlyWatchedData } = useSWR(
    buildURL('/api/authenticated/admin/recently-watched'),
    fetcher,
    { refreshInterval: 2000 }
  )

  // Derived during render — no useState/useEffect needed
  const lastSyncTime = processLastSyncTimeData(lastSyncData ?? _lastSyncTime)

  // Refreshes the user-management table after approve/limit actions.
  // (Media data is now managed under /admin/media, not on the dashboard.)
  async function updateProcessedData(type) {
    if (type && type !== 'users') return

    const maxRetries = 3
    let retries = 0

    while (retries < maxRetries) {
      try {
        const res = await axios.get(buildURL('/api/authenticated/admin/users'))
        const { processedUserData } = res.data
        setProcessedUserData(processedUserData)
        return
      } catch (error) {
        retries++
        if (retries === maxRetries) {
          console.error(`Failed to fetch user data after ${maxRetries} attempts:`, error)
          throw error
        }
        await new Promise((resolve) => setTimeout(resolve, 1000 * retries))
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
            setIsOpen={(val) => { setIsSyncOpen(val); if (!val) setSyncAutoConnect(false) }}
            updateProcessedData={updateProcessedData}
            setLastSync={() => mutateLastSync()}
            autoConnect={syncAutoConnect}
          />
        )}
        {/* Dashboard Header */}
        <DashboardHeader
          onSyncClick={() => setIsSyncOpen(true)}
          lastSyncTime={lastSyncTime}
          totalUsers={_processedUserData.data?.length ?? 0}
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
                <EnhancedServerProcesses onSyncViewClick={() => { setSyncAutoConnect(true); setIsSyncOpen(true) }} />
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
                <EnhancedQueueDashboard />
              </MaterialCardContent>
            </MaterialCard>
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
                  <EnhancedRecentlyWatched recentlyWatched={recentlyWatchedData} />
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
