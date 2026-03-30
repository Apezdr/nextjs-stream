'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import useSWR from 'swr'
import { fetcher } from '@src/utils'

/**
 * Client component that polls the approval status endpoint
 * and auto-redirects to /list when the user is approved
 * 
 * Used on the auth/error page when user is pending approval
 * Displays as an animated status pill with breathing indicator
 */
export default function PendingApprovalPoller() {
  const router = useRouter()
  const [dots, setDots] = useState('')

  // Poll approval status every 10 seconds
  // Revalidate on focus to catch approvals when tab regains focus
  const { data, error } = useSWR(
    '/api/auth/approval-status',
    fetcher,
    {
      refreshInterval: 10000, // Poll every 10 seconds
      revalidateOnFocus: true,
      dedupingInterval: 5000, // Dedupe requests within 5 seconds
    }
  )

  // Animated dots effect
  useEffect(() => {
    const id = setInterval(() => {
      setDots((d) => (d.length >= 3 ? '' : d + '.'))
    }, 600)
    return () => clearInterval(id)
  }, [])

  // Auto-redirect when approved
  useEffect(() => {
    if (data?.approved) {
      router.push('/list')
    }
  }, [data?.approved, router])

  return (
    <div>
      <div
        className="inline-flex items-center rounded-full border"
        style={{
          gap: 10,
          padding: '10px 22px',
          background: 'rgba(168, 140, 96, 0.08)',
          borderColor: 'rgba(168, 140, 96, 0.15)',
        }}
      >
        <div
          className="rounded-full"
          style={{
            width: 7,
            height: 7,
            background: '#d4a853',
            animation: 'subtleBreathe 2s ease-in-out infinite',
          }}
        />
        <span
          className="uppercase"
          style={{
            fontFamily: "'DM Sans', sans-serif",
            fontSize: 13,
            fontWeight: 400,
            color: '#a88c60',
            letterSpacing: '0.04em',
          }}
        >
          Pending review{dots}
        </span>
      </div>
      {error && (
        <p
          className="text-xs mt-3"
          style={{
            fontFamily: "'DM Sans', sans-serif",
            color: 'rgba(168, 160, 145, 0.5)',
          }}
        >
          Unable to check status automatically
        </p>
      )}
    </div>
  )
}
