import { Suspense } from 'react'
import clientPromise from '@src/lib/mongodb'
import { fetchFlatBannerMedia } from '@src/utils/flatDatabaseUtils'
import BannerWithVideoContainer from './BannerWithVideoContainer'
import BannerSkeleton from './BannerSkeleton'

// Server component that pre-fetches banner data
async function BannerDataFetcher() {
  // Fetch banner data server-side
  let bannerMediaList = []
  try {
    const mediaResult = await fetchFlatBannerMedia()
    if (!mediaResult.error && Array.isArray(mediaResult)) {
      bannerMediaList = mediaResult
    }
  } catch (error) {
    console.error('Error fetching banner data server-side:', error)
  }

  // Pass initial data to client component
  // Client component will continue polling with SWR
  return <BannerWithVideoContainer initialData={bannerMediaList} />
}

// Main wrapper with Suspense boundary for PPR
// Derive banner count from fetched data length (eliminates redundant count query)
export default async function BannerWithVideoWrapper() {
  // Default bannerCount for skeleton - will be refined after data fetch
  let bannerCount = 3 // Default fallback
  
  try {
    const mediaResult = await fetchFlatBannerMedia()
    // Derive count from actual data instead of separate count query (eliminates waterfall)
    if (!mediaResult.error && Array.isArray(mediaResult)) {
      bannerCount = Math.min(mediaResult.length, 8)
    }
  } catch (error) {
    console.error('Error fetching banner count:', error)
  }

  return (
    <Suspense fallback={<BannerSkeleton bannerCount={bannerCount} />}>
      <BannerDataFetcher />
    </Suspense>
  )
}
