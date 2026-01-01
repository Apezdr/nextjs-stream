'use client'
import { useState, useEffect } from 'react'


export default function AsyncMediaCounts({suffix = '', showDuration = false}) {
  const [counts, setCounts] = useState({
    moviesCount: 0,
    tvProgramsCount: 0,
    movieHours: 0,
    tvHours: 0,
    totalHours: 0,
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
            movieHours: data.movieHours || 0,
            tvHours: data.tvHours || 0,
            totalHours: data.totalHours || 0,
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
        <>
          {showDuration && (
            <span className="block text-sm text-gray-100">
              {counts.totalHours > 0 
                ? `${counts.totalHours.toLocaleString()} hours total`
                : ''}
            </span>
          )}
          ({counts.moviesCount + counts.tvProgramsCount})
          {suffix}
        </>
      )}
    </span>
  )
}
