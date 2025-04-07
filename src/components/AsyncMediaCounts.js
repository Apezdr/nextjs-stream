'use client'
import { useState, useEffect } from 'react'


export default function AsyncMediaCounts({suffix = ''}) {
  const [counts, setCounts] = useState({
    moviesCount: 0,
    tvProgramsCount: 0,
    isLoading: true
  })

  useEffect(() => {
    async function fetchCounts() {
      try {
        // Fetch counts from our unified endpoint
        const response = await fetch('/api/authenticated/count')

        if (response.ok) {
          const data = await response.json()
          
          setCounts({
            moviesCount: data.moviesCount || 0,
            tvProgramsCount: data.tvShowsCount || 0,
            isLoading: false
          })
        } else {
          console.error('Failed to fetch counts')
          setCounts({
            moviesCount: 0,
            tvProgramsCount: 0,
            isLoading: false
          })
        }
      } catch (error) {
        console.error('Error fetching counts:', error)
        setCounts({
          moviesCount: 0,
          tvProgramsCount: 0,
          isLoading: false
        })
      }
    }

    fetchCounts()
  }, [])

  return (
    <span>
      {counts.isLoading ? (
        <></>
      ) : (
        <>({counts.moviesCount + counts.tvProgramsCount}){suffix}</>
      )}
    </span>
  )
}
