'use client'

import { buildURL, fetcher } from "@src/utils"
import useSWR from 'swr'

export default function LastSyncTime({ lastSyncTime: initialLastSyncTime }) {
    const { data, error } = useSWR(buildURL(`/api/authenticated/admin/lastSynced`), fetcher, {
        refreshInterval: 5000,
        revalidateOnFocus: true,
        revalidateOnReconnect: true,
        fallbackData: { lastSyncTime: initialLastSyncTime },
    })
    
    let displayTime = 'Loading...'

    if (error) {
        displayTime = 'Error loading sync time'
    } else if (data && data.lastSyncTime) {
        const date = new Date(data.lastSyncTime)
        displayTime = isNaN(date) ? 'Invalid Date' : date.toLocaleString()
    }

    return (
        <div className="flex-auto border-t border-gray-200 w-1/2 mt-5 pt-4">
            <h3 className="text-sm font-semibold leading-6 text-gray-900">
                Last Sync Time
            </h3>
            <p className="mt-1 text-sm leading-6 text-gray-500">
                {displayTime}
            </p>
        </div>
    )
}
