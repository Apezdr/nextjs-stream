import { fetchFlatBannerMedia } from '@src/utils/flatDatabaseUtils'
import { generateETag } from '@src/utils/cache/etagHelpers'
import BannerWithVideoContainer from './BannerWithVideoContainer'

/**
 * Server half of the /list banner: one query, rendered straight away, and
 * handed to the client with the ETag /api/authenticated/banner gives the same
 * data, so the client's first revalidation is a 304 instead of a second
 * download of the banner. The layout's Suspense boundary shows the
 * placeholder while this loads.
 *
 * It used to query twice (the first only to size a skeleton the second then
 * replaced) and hand over no ETag.
 */
export default async function BannerWithVideoWrapper() {
  let bannerMediaList = []
  let bannerETag = null
  try {
    const mediaResult = await fetchFlatBannerMedia()
    if (!mediaResult.error && Array.isArray(mediaResult)) {
      bannerMediaList = mediaResult
      // The banner route hashes exactly this for a web request
      bannerETag = generateETag(JSON.stringify(mediaResult))
    }
  } catch (error) {
    console.error('Error fetching banner data server-side:', error)
  }

  // Client component will continue polling with SWR
  return <BannerWithVideoContainer initialData={bannerMediaList} initialETag={bannerETag} />
}
