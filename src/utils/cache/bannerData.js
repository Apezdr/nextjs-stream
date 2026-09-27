import { cacheLife, cacheTag } from 'next/cache'
import { queryBannerMovies } from '@src/utils/flatDatabaseUtils'
import { MEDIA_CACHE_TAGS } from './mediaPagesTags'

/**
 * The banner's movies, cached in memory and shared by every banner poll, the
 * /list server render and the TV app, so the query runs when the list can
 * have changed instead of once per poll per client.
 *
 * Kept fresh by expiring the 'banner' tag (expireBannerCache): the post-sync
 * revalidation route does it when a sync changes or removes movies, and the
 * admin movie actions on every edit. The `banner` cacheLife only bounds how
 * far behind it can fall after a write that does neither (the legacy sync
 * fallback, blurhash sync, a manual edit): 30 s, then a background refresh.
 *
 * A failed query throws out of here, and a cache entry that throws is not
 * stored. The result is plain JSON: what the banner route sends, and nothing a
 * cache entry cannot hold.
 */
async function getCachedBannerMovies() {
  'use cache'
  cacheLife('banner')
  cacheTag(MEDIA_CACHE_TAGS.BANNER, 'movies')

  return JSON.parse(JSON.stringify(await queryBannerMovies()))
}

/**
 * Fetch the latest movies for the banner.
 *
 * @returns {Promise<Array|Object>} An array of the latest 8 movie objects or an error object.
 */
export async function fetchFlatBannerMedia() {
  try {
    const media = await getCachedBannerMovies()

    if (media.length === 0) {
      return { error: 'No media found for banner', status: 404 }
    }

    return media
  } catch (error) {
    console.error(`Error in fetchFlatBannerMedia: ${error.message}`)
    return { error: 'Failed to fetch banner media', details: error.message, status: 500 }
  }
}
