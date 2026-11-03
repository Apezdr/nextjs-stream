import { fetchFlatBannerMedia } from '@src/utils/cache/bannerData'
import { viewerLibraryAccess } from '@src/lib/roles/session'
import { generateETag } from '@src/utils/cache/etagHelpers'
import BannerWithVideoContainer from './BannerWithVideoContainer'

/**
 * Server half of the /list banner: one query, rendered straight away, and
 * handed to the client with the ETag /api/authenticated/banner gives the same
 * data, so the client's first revalidation is a 304 instead of a second
 * download of the banner. The layout's Suspense boundary shows the
 * placeholder while this loads.
 *
 * The banner shows only the viewer's library scope.
 *
 * It used to query twice (the first only to size a skeleton the second then
 * replaced) and hand over no ETag.
 */
export default async function BannerWithVideoWrapper() {
  let bannerMediaList = []
  let bannerETag = null
  try {
    const access = await viewerLibraryAccess()
    // Signed out: SessionChrome renders no banner, so nothing is fetched
    const mediaResult = access ? await fetchFlatBannerMedia(access) : { error: 'Signed out' }
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
