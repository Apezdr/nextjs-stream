'use client'

import { useAppDateFormatter } from '@src/contexts/AppTimeZoneContext'

export default function AppDateTime({ value, options }) {
  const { formatDateTime } = useAppDateFormatter()
  return formatDateTime(value, options)
}