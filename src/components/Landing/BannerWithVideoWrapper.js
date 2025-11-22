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
// Fetch banner count outside Suspense for skeleton
export default async function BannerWithVideoWrapper() {
  let bannerCount = 3 // Default fallback
  
  try {
    const client = await clientPromise
    const db = client.db('Media')
    
    // Quick count query - more efficient than fetching full data
    const totalCount = await db.collection('FlatMovies').countDocuments({})
    
    bannerCount = Math.min(totalCount, 8) // Cap at 8 (our limit in fetchFlatBannerMedia)
  } catch (error) {
    console.error('Error fetching banner count:', error)
  }

  return (
    <Suspense fallback={<BannerSkeleton bannerCount={bannerCount} />}>
      <BannerDataFetcher />
    </Suspense>
  )
}