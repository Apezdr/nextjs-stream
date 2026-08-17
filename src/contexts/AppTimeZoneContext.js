'use client'

import { createContext, useContext } from 'react'
import { DEFAULT_APP_TIME_ZONE, formatDateOnly, formatDateTime } from '@src/utils/dateTime'

const AppTimeZoneContext = createContext(DEFAULT_APP_TIME_ZONE)

export function AppTimeZoneProvider({ timeZone, children }) {
  return (
    <AppTimeZoneContext.Provider value={timeZone || DEFAULT_APP_TIME_ZONE}>
      {children}
    </AppTimeZoneContext.Provider>
  )
}

export function useAppTimeZone() {
  return useContext(AppTimeZoneContext)
}

export function useAppDateFormatter() {
  const timeZone = useAppTimeZone()
  return {
    timeZone,
    formatDateTime: (value, options) => formatDateTime(value, timeZone, options),
    formatDateOnly: (value, options) => formatDateOnly(value, timeZone, options),
  }
}