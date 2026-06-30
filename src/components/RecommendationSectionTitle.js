'use client'
import useSWR from 'swr'

const checkWatchHistory = async (url) => {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const data = await response.json()
  return data.hasWatchHistory || false
}

export default function RecommendationSectionTitle() {
  const { data: hasWatchHistory } = useSWR(
    '/api/authenticated/count?type=recentlyWatched',
    checkWatchHistory,
    {
      revalidateOnFocus: false,
      onError: (error) => console.error('Error checking watch history:', error),
    }
  )

  return (
    <h2 className="text-xl font-bold text-left mt-4 ml-4">
      {hasWatchHistory ? "Recommended For You" : "Popular Content"}
    </h2>
  )
}
