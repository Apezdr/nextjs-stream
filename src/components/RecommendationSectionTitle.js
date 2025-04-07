'use client'
import { useState, useEffect } from 'react'

export default function RecommendationSectionTitle() {
  const [hasWatchHistory, setHasWatchHistory] = useState(false)
  
  useEffect(() => {
    async function checkWatchHistory() {
      try {
        const response = await fetch('/api/authenticated/count?type=recentlyWatched')
        if (response.ok) {
          const data = await response.json()
          setHasWatchHistory(data.hasWatchHistory || false)
        }
      } catch (error) {
        console.error('Error checking watch history:', error)
      }
    }
    
    checkWatchHistory()
  }, [])
  
  return (
    <h2 className="text-xl font-bold text-left mt-4 ml-4">
      {hasWatchHistory ? "Recommended For You" : "Popular Content"}
    </h2>
  )
}
